import { installFeedback } from './feedback';
import { takeReviewToken, watchReviewHash } from './lib/reviewGate';
import { extraHashKeys, langOfLocation, pageOfPath, routeOfLocation, urlOfRoute } from './lib/pagePath';
import { detectLang, storedLang } from './lib/i18n';

installFeedback();
const reviewToken = takeReviewToken();
watchReviewHash();
if (reviewToken) void import('./review').then(m => m.install(reviewToken));

const page = pageOfPath(location.pathname);
const route = routeOfLocation(location.pathname, location.hash);
const language = detectLang(langOfLocation(location.pathname, location.hash), storedLang(), navigator.languages);
if ((route.view === 'feature' || route.view === 'features') && page?.kind !== 'feature' && page?.kind !== 'features') {
  const url = urlOfRoute(route, language);
  const extra = extraHashKeys(location.hash);
  location.replace(url + (extra ? (url.includes('#') ? '&' : '#') + extra : ''));
} else if (page?.kind === 'feature' || page?.kind === 'features') {
  void import('./features/page');
} else {
  void import('./main');
}
