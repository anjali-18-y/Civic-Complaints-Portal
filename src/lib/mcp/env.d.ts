// The tool files run inside the generated Deno edge function, but they are
// type-checked as part of the Vite/React project. Declare a minimal `process`
// so `process.env.SUPABASE_*` type-checks without pulling in @types/node.
declare const process: {
  env: Record<string, string | undefined>;
};