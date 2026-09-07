const request = {
  locations: [
    { lat: 50.4501, lon: 30.5234 },
    { lat: 50.4547, lon: 30.5168 },
  ],
  costing: 'pedestrian',
  units: 'kilometers',
};
const response = await fetch(
  'https://valhalla1.openstreetmap.de/route?json=' +
    encodeURIComponent(JSON.stringify(request)),
  {
    headers: { Origin: 'http://localhost:3000' },
    signal: AbortSignal.timeout(25000),
  },
);
const data = await response.json();
console.log(
  JSON.stringify({
    status: response.status,
    cors: response.headers.get('access-control-allow-origin'),
    summary: data.trip?.summary,
    error: data.error,
  }),
);
if (!response.ok || data.trip?.status !== 0) process.exitCode = 1;
