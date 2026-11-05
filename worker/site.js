import backend from './index.js';

// Preserve the frontend's existing TEXT_API and asset URLs. Only this explicit
// namespace reaches the experimental backend; it is not a production cutover.
export function createSite(api = backend) {
  return {
    async fetch(request, env, ctx) {
      const path = new URL(request.url).pathname;
      if (path === '/api' || path === '/api/') return api.fetch(request, env, ctx);
      if (path.startsWith('/api/')) {
        return Response.json({error: 'Unknown API route'}, {
          status: 404, headers: {'Cache-Control': 'no-store'},
        });
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method not allowed', {status: 405, headers: {Allow: 'GET, HEAD'}});
      }
      return env.ASSETS.fetch(request);
    },
  };
}

export default createSite();
