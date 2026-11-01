import { ImageResponse } from 'next/og';
import { readFile } from 'fs/promises';
import path from 'path';

export const runtime = 'nodejs';
export const alt = 'YOURPEDIA | YourChain Knowledge Hub';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  const logoBuffer = await readFile(path.join(process.cwd(), 'public/logo-light.png'));
  const logoSrc = `data:image/png;base64,${logoBuffer.toString('base64')}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: '#0A0B0F',
          color: '#ffffff',
          padding: '72px 88px',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 44 }}>
          <img
            src={logoSrc}
            width={180}
            height={180}
            style={{ objectFit: 'contain' }}
          />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                fontSize: 124,
                fontWeight: 800,
                lineHeight: 1,
                letterSpacing: -2,
              }}
            >
              YOURPEDIA
            </div>
            <div
              style={{
                fontSize: 28,
                fontWeight: 400,
                opacity: 0.7,
                marginTop: 16,
              }}
            >
              YourChain Knowledge Hub
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: 'auto',
            display: 'flex',
            justifyContent: 'center',
            fontSize: 26,
            fontWeight: 500,
            color: '#ffffff',
            opacity: 0.85,
          }}
        >
          Powered by Your Organization
        </div>
      </div>
    ),
    size,
  );
}
