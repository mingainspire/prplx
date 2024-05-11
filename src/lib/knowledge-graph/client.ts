import {getEnv} from "@llamaindex/env";
import {DateTime} from "luxon";

export interface DocumentInfo {
  uri: string,
  text: string
}

export class KnowledgeGraphClient {
  baseURL: string;

  constructor(init?: Partial<KnowledgeGraphClient>) {
    const baseURL = init?.baseURL ?? getEnv('GRAPH_RAG_API_URL');
    if (!baseURL) {
      throw new Error('GRAPH_RAG_API_URL is required');
    }
    this.baseURL = baseURL;
  }

  async search(query: string) {
    try {
      const url = `${this.baseURL}/api/search`;
      const start = DateTime.now();
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
        })
      });
      const data = await res.json();
      const end = DateTime.now();
      const duration = end.diff(start, 'seconds').seconds;
      const { entities = [], relationships = [], chunks = [] } = data;
      console.log(
        `Finished knowledge graph searching, take ${duration} seconds, got ${entities.length} entities, ${relationships.length} relationships, ${chunks.length} chunks.`
      );
      return data;
    } catch (err) {
      console.error('Failed to search using Graph RAG.', err);
      throw err;
    }
  }

  async buildIndex(doc: DocumentInfo) {
    try {
      const url = `${this.baseURL}/api/build`;
      const start = DateTime.now();
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(doc)
      });
      if (!res.ok) {
        throw new Error(`Failed to call build knowledge graph index API for doc (url: ${doc.uri}): ${res.statusText}`);
      }
      const data = await res.json();
      const end = DateTime.now();
      const duration = end.diff(start, 'seconds').seconds;
      if (data.status === 'done') {
        console.log(`Finish knowledge graph building, take ${duration} seconds.`);
      } else {
        console.log(`Knowledge graph building not done yet, status: ${data.status}`);
      }
      return data;
    } catch (err) {
      console.error(`Failed to build knowledge graph for doc: ${doc.uri}`, err);
      throw err;
    }
  }

}