import { z } from 'zod';
import { AppError, type AgentRole } from '@emilio/shared';
import type { ModelCaller, CallResult } from '../llm/call-model';
import type { QueuedTask } from '../queue/queue';
import type { AgentDefinition } from './registry';

/** Extrait le premier objet JSON d'une réponse (les modèles ajoutent parfois du texte ou des ```json). */
export function extractJson(text: string): unknown {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    /* continue */
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
  const start = (fenced?.[1] ?? t).indexOf('{');
  const src = fenced?.[1] ?? t;
  if (start < 0) throw new Error('Aucun objet JSON trouvé');
  let depth = 0;
  let inStr = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(src.slice(start, i + 1));
  }
  throw new Error('JSON incomplet');
}

export type Executed<T> = { output: T; call: Omit<CallResult, 'content'> };

export type StructuredParams<T extends z.ZodType> = {
  missionId: string;
  taskId: string | null;
  role: AgentRole;
  label: string;
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  schema: T;
  schemaName: string;
  temperature: number;
  promptVersion: string;
  signal?: AbortSignal;
};

/**
 * Appel de modèle avec sortie JSON validée (CdC §8.3) : prompt → appel → validation zod ;
 * en cas d'échec de validation, UN réessai avec le message d'erreur renvoyé au modèle, puis échec E_SCHEMA.
 */
export async function runStructured<T extends z.ZodType>(
  caller: ModelCaller,
  p: StructuredParams<T>,
): Promise<Executed<z.infer<T>>> {
  const messages = [...p.messages];
  const jsonSchema = {
    name: p.schemaName,
    schema: z.toJSONSchema(p.schema) as Record<string, unknown>,
  };
  let cost = { tokensIn: 0, tokensOut: 0, costUsd: 0, model: '' };
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await caller.call({
      missionId: p.missionId,
      taskId: p.taskId,
      role: p.role,
      messages,
      temperature: p.temperature,
      jsonSchema,
      promptVersion: p.promptVersion,
      label: p.label,
      signal: p.signal,
    });
    cost = {
      tokensIn: cost.tokensIn + res.tokensIn,
      tokensOut: cost.tokensOut + res.tokensOut,
      costUsd: cost.costUsd + res.costUsd,
      model: res.model,
    };
    try {
      const parsed = p.schema.safeParse(extractJson(res.content));
      if (parsed.success) return { output: parsed.data, call: cost };
      messages.push(
        { role: 'assistant', content: res.content },
        {
          role: 'user',
          content: `Ta réponse ne respecte pas le schéma : ${z.prettifyError(parsed.error)}. Corrige.`,
        },
      );
    } catch (e) {
      messages.push(
        { role: 'assistant', content: res.content },
        {
          role: 'user',
          content: `Ta réponse n'est pas du JSON valide (${(e as Error).message}). Corrige.`,
        },
      );
    }
  }
  throw new AppError('E_SCHEMA');
}

/** Exécution d'une tâche d'agent de la file (prompt système de l'agent + entrée de la tâche). */
export function executeAgentTask<T extends z.ZodType>(
  caller: ModelCaller,
  agent: AgentDefinition<T>,
  task: QueuedTask,
  signal?: AbortSignal,
): Promise<Executed<z.infer<T>>> {
  const label = String(task.input.label ?? agent.role);
  return runStructured(caller, {
    missionId: task.missionId,
    taskId: task.id,
    role: agent.role,
    label,
    messages: [
      { role: 'system', content: agent.systemPrompt({ label }) },
      { role: 'user', content: JSON.stringify({ tache: label, entree: task.input }) },
    ],
    schema: agent.schema,
    schemaName: agent.schemaName,
    temperature: agent.temperature,
    promptVersion: agent.promptVersion,
    signal,
  });
}
