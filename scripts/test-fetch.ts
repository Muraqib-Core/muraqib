import axios from 'axios';

(async () => {
  try {
    const res = await axios.get('http://localhost:3000', { timeout: 10000 });
    console.log('status', res.status);
    console.log('headers', res.headers);
    console.log('data:', res.data);
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.error('fetch error:', err.message);
    const axiosErr = e as { response?: { status: number; headers: unknown; data: unknown } };
    if (axiosErr.response) {
      console.error('status', axiosErr.response.status);
      console.error('headers', axiosErr.response.headers);
      const data = String(axiosErr.response.data);
      console.error('data', data);
      const fs = await import('fs');
      await fs.promises.mkdir('logs', { recursive: true });
      await fs.promises.writeFile('logs/server-error.html', data, 'utf-8');
      console.error('Saved response HTML to logs/server-error.html');
    }
  }
})();