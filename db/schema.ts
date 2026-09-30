import {sqliteTable,text,integer} from 'drizzle-orm/sqlite-core';
export const voiceBudget=sqliteTable('voice_budget',{id:text('id').primaryKey(),used:integer('used').notNull().default(0)});
