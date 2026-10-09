/** Answers `.css` imports (vite handles them for real; Node tests do not need them). */
const STUB = 'data:text/javascript,export default {}';
export async function resolve(specifier, context, next) {
  if (specifier.endsWith('.css')) return { url: STUB, shortCircuit: true };
  return next(specifier, context);
}
