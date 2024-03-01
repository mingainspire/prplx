import database from '@/core/db';
import { adminHandlerGuard } from '@/lib/auth-server';
import { baseRegistry } from '@/rag-spec/base';
import { NextResponse } from 'next/server';

export const PUT = adminHandlerGuard(async (req, { params }: { params: { name: string } }) => {
  const indexName = decodeURIComponent(params.name);
  const data = await req.json();

  const updatingConfig = {} as any;
  for (const [k, v] of Object.entries(data)) {
    const ctor = await baseRegistry.getComponent(k);
    if (!ctor) {
      return NextResponse.json({
        message: `unknown extension ${k}`,
      }, { status: 400 });
    }
    const result = ctor.optionsSchema.safeParse(v);
    if (result.success) {
      updatingConfig[k] = result.data;
    } else {
      return NextResponse.json({
        message: result.error.message,
      }, { status: 400 });
    }
  }

  await database.index.update(indexName, index => {
    return { config: JSON.stringify(Object.assign(index.config as any, updatingConfig)) };
  });
  return new NextResponse();
});

export const dynamic = 'force-dynamic';
