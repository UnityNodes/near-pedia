import { NextResponse } from 'next/server';
import { getSourceInventory } from '@/lib/sources';

export const dynamic = 'force-dynamic';

export async function GET() {
  const inventory = await getSourceInventory();
  return NextResponse.json(inventory);
}
