export function siteBase(value = '/') {
  const base = '/' + value.trim().replace(/^\/+|\/+$/g, '') + '/';
  if (base === '//') return '/';
  if (
    !/^\/(?:[a-zA-Z0-9_.-]+\/)+$/.test(base) ||
    base.split('/').some((part) => part === '.' || part === '..')
  ) {
    throw new Error(
      'APP_BASE_PATH must be a URL path such as /daily-step-map/.',
    );
  }
  return base;
}
