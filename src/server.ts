import { config } from './config';
import app from './app';
import { prisma } from './lib/prisma';

async function bootstrap() {
  try {
    await prisma.$connect();
    console.log('✓ Database connected');

    app.listen(config.port, () => {
      console.log(`✓ Server running on http://localhost:${config.port}`);
      console.log(`  Environment : ${config.nodeEnv}`);
      console.log(`  Health      : http://localhost:${config.port}/health`);
    });
  } catch (err) {
    console.error('✗ Failed to start server:', err);
    await prisma.$disconnect();
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

bootstrap();
