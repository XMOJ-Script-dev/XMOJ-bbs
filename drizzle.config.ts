import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './Source/schema.ts',
  out: './migrations-drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: './.wrangler/d1/DB.sqlite',
  },
  verbose: true,
  strict: true,
});
