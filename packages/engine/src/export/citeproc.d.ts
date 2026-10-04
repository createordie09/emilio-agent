declare module 'citeproc' {
  type Sys = {
    retrieveLocale(lang: string): string;
    retrieveItem(id: string): unknown;
  };
  type Cluster = {
    citationID: string;
    citationItems: { id: string; locator?: string; label?: string }[];
    properties: { noteIndex: number };
  };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  class Engine {
    constructor(sys: Sys, style: string, lang?: string, forceLang?: boolean);
    processCitationCluster(
      citation: Cluster,
      citationsPre: [string, number][],
      citationsPost: [string, number][],
    ): [{ bibchange: boolean }, [number, string, string][]];
    makeBibliography(): [{ entry_ids: string[][] }, string[]] | false;
    updateItems(ids: string[]): void;
  }
  const CSL: { Engine: typeof Engine };
  export default CSL;
}
