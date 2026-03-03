/**
 * HTTP server entry point.
 *
 * Runs standalone with:  npm run dev  (dev)  or  npm start  (prod)
 * Docker:  docker build -t hotel-robot . && docker run -p 3000:3000 hotel-robot
 *
 * No external process manager required — just Node.js.
 */
import 'dotenv/config';
declare const app: import("fastify").FastifyInstance<import("http").Server<typeof import("http").IncomingMessage, typeof import("http").ServerResponse>, import("http").IncomingMessage, import("http").ServerResponse<import("http").IncomingMessage>, import("fastify").FastifyBaseLogger, import("fastify").FastifyTypeProviderDefault> & PromiseLike<import("fastify").FastifyInstance<import("http").Server<typeof import("http").IncomingMessage, typeof import("http").ServerResponse>, import("http").IncomingMessage, import("http").ServerResponse<import("http").IncomingMessage>, import("fastify").FastifyBaseLogger, import("fastify").FastifyTypeProviderDefault>>;
export { app };
