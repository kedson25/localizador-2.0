import { defineConfig } from 'vitest/config';

// O motor de CSV é independente dos serviços e plugins da aplicação.
export default defineConfig({ test: { include: ['tests/dynamic-csv.test.ts'] } });
