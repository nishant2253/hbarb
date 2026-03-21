import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

/**
 * Next.js API route that proxies the Gemini agent build request to the backend.
 * This avoids CORS issues when calling from the browser.
 *
 * POST /api/agents/build-from-prompt
 * Body: { prompt: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const res = await fetch(`${API_URL}/api/agents/build`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error('[build-from-prompt]', err);
    return NextResponse.json(
      { error: 'Failed to connect to TradeAgent API' },
      { status: 502 }
    );
  }
}
