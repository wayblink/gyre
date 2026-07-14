import { createDb } from './db.js';
import { seedDemoBusinessData } from './seed.js';

function printUsage() {
  console.log('Usage: npm run seed:demo -- --force [--allow-production]');
  console.log('');
  console.log('Options:');
  console.log('  --force              Confirm importing demo business data');
  console.log('  --allow-production   Allow running when NODE_ENV=production');
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const force = args.has('--force');
  const allowProduction = args.has('--allow-production');

  if (args.has('--help') || args.has('-h')) {
    printUsage();
    return;
  }

  if (!force) {
    printUsage();
    throw new Error('Refusing to import demo business data without --force.');
  }
  if (process.env.NODE_ENV === 'production' && !allowProduction) {
    throw new Error('Refusing to import demo business data in production without --allow-production.');
  }
  const db = await createDb();
  try {
    await seedDemoBusinessData(db);
    console.log('Demo business data imported.');
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});