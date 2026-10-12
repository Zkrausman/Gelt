import { connectionBff } from '../../../../lib/connection-bff';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request: Request, context: { params: Promise<{ operation: string }> }) {
  return connectionBff().handle(request, (await context.params).operation);
}
export { handle as POST, handle as GET };
