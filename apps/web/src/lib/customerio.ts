const WRITE_KEY = (import.meta.env.VITE_CUSTOMERIO_WRITE_KEY as string)?.trim() ?? '';

declare global {
  interface Window {
    cioanalytics: any;
  }
}

let initialized = false;

export function initCustomerIO() {
  if (initialized || !WRITE_KEY) return;

  const stub: any = [];
  window.cioanalytics = stub;

  stub.methods = ['track', 'identify', 'page', 'reset', 'group', 'alias'];
  stub.factory = function (method: string) {
    return function (...args: any[]) {
      args.unshift(method);
      stub.push(args);
      return stub;
    };
  };
  for (const method of stub.methods) {
    stub[method] = stub.factory(method);
  }

  const script = document.createElement('script');
  script.type = 'text/javascript';
  script.async = true;
  script.src = `https://cdp.customer.io/v1/analytics-js/snippet/${WRITE_KEY}/analytics.min.js`;
  const first = document.getElementsByTagName('script')[0];
  first.parentNode!.insertBefore(script, first);

  initialized = true;
}

export const analytics = {
  track(event: string, properties?: Record<string, unknown>) {
    window.cioanalytics?.track(event, properties);
  },
  identify(userId: string, traits?: Record<string, unknown>) {
    window.cioanalytics?.identify(userId, traits);
  },
  page() {
    window.cioanalytics?.page();
  },
  reset() {
    window.cioanalytics?.reset();
  },
};
