import { z } from 'zod';
import { AppError } from '@emilio/shared';
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

/**
 * Exécution d'une tâche LLM (CdC §8.3) : prompt → appel → validation zod ;
 * en cas d'échec de validation, UN réessai avec le message d'erreur renvoyé au modèle, puis échec E_SCHEMA.
 */
export async function executeAgentTask<T extends z.ZodType>(
  caller: ModelCaller,
  agent: AgentDefinition<T>,
  task: QueuedTask,
  signal?: AbortSignal,
): Promise<Executed<z.infer<T>>> {
  const label = String(task.input.label ?? agent.role);
  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: agent.systemPrompt({ label }) },
    { role: 'user', content: JSON.stringify({ tache: label, entree: task.input }) },
  ];
  const jsonSchema = {
    name: agent.schemaName,
    schema: z.toJSONSchema(agent.schema) as Record<string, unknown>,
  };
  let cost = { tokensIn: 0, tokensOut: 0, costUsd: 0, model: '' };

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await caller.call({
      missionId: task.missionId,
      taskId: task.id,
      role: agent.role,
      messages,
      temperature: agent.temperature,
      jsonSchema,
      promptVersion: agent.promptVersion,
      label,
      signal,
    });
    cost = {
      tokensIn: cost.tokensIn + res.tokensIn,
      tokensOut: cost.tokensOut + res.tokensOut,
      costUsd: cost.costUsd + res.costUsd,
      model: res.model,
    };
    try {
      const parsed = agent.schema.safeParse(extractJson(res.content));
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
