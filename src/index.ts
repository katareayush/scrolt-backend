import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import { healthRouter } from './routes/health';
import { cardsRouter } from './routes/cards';

const app = express();

app.use(cors());
app.use(express.json());

app.use('/health', healthRouter);
app.use('/api/cards', cardsRouter);

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(env.PORT, () => {
  console.log(`🚀 Server running on port ${env.PORT}`);
});

process.on('SIGINT', () => {
  console.log('\n🔄 Shutting down server...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\n🔄 Shutting down server...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});