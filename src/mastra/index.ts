import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { DuckDBStore } from '@mastra/duckdb';
import { MastraCompositeStore } from '@mastra/core/storage';
import { Observability, MastraStorageExporter, MastraPlatformExporter, SensitiveDataFilter } from '@mastra/observability';
import { githubWebhookRoute } from './routes/github-webhook';
import { slackHelloRoute } from './routes/slack-hello';
import { triageAgent } from './agents/triage';
import { triageWorkflow } from './workflows/triage';

export const mastra = new Mastra({
  agents: { triageAgent },
  workflows: { triageWorkflow },
  server: {
    apiRoutes: [
      githubWebhookRoute,
      // Wiring check only — never shipped: an unauthenticated route that can
      // post to the factory channel has no business in a production build.
      ...(process.env.NODE_ENV === 'production' ? [] : [slackHelloRoute]),
    ],
  },
  storage: new MastraCompositeStore({
    id: 'composite-storage',
    default: new LibSQLStore({
      id: 'mastra-storage',
      url: 'file:./mastra.db',
    }),
    domains: {
      observability: await new DuckDBStore().getStore('observability'),
    },
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [
          new MastraStorageExporter(), // Persists observability events to Mastra Storage
          new MastraPlatformExporter(), // Sends observability events to Mastra Platform (if MASTRA_PLATFORM_ACCESS_TOKEN is set)
        ],
        spanOutputProcessors: [
          new SensitiveDataFilter(), // Redacts sensitive data like passwords, tokens, keys
        ],
      },
    },
  }),
});
