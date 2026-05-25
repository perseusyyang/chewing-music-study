/**
 * Minimal hash router. Maps "#/path" → handler function.
 * Start by calling .start(); navigate by setting window.location.hash
 * or by calling router.navigate(path).
 */
export class Router {
  constructor(routes, defaultRoute = '/consent') {
    this.routes = routes;
    this.defaultRoute = defaultRoute;
  }

  start() {
    window.addEventListener('hashchange', () => this._handle());
    this._handle();
  }

  navigate(path) {
    window.location.hash = '#' + path;
  }

  _handle() {
    const path = window.location.hash.replace(/^#/, '') || this.defaultRoute;
    const handler = this.routes[path] || this.routes[this.defaultRoute];
    if (handler) handler();
  }
}
