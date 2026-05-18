import { db } from '../db/connection';
import { sql } from 'drizzle-orm';

async function createOptimizedIndexes() {
  try {
    console.log('Creating optimized database indexes...');

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_cards_category_difficulty_id 
      ON cards (category, difficulty, id);
    `);
    console.log('✓ Created composite index: idx_cards_category_difficulty_id');

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_cards_difficulty_id 
      ON cards (difficulty, id);
    `);
    console.log('✓ Created composite index: idx_cards_difficulty_id');

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_cards_category_id 
      ON cards (category, id);
    `);
    console.log('✓ Created composite index: idx_cards_category_id');

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_user_progress_userid_cardid 
      ON user_progress (user_id, card_id);
    `);
    console.log('✓ Created composite index: idx_user_progress_userid_cardid');

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_user_progress_userid_answered 
      ON user_progress (user_id, answered_at DESC);
    `);
    console.log('✓ Created composite index: idx_user_progress_userid_answered');

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_cards_id_btree 
      ON cards USING btree (id);
    `);
    console.log('✓ Ensured B-tree index: idx_cards_id_btree');

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_user_progress_cardid 
      ON user_progress (card_id);
    `);
    console.log('✓ Created index: idx_user_progress_cardid');

    console.log('All optimized indexes created successfully!');
  } catch (error) {
    console.error('Error creating indexes:', error);
    process.exit(1);
  }
}

createOptimizedIndexes();