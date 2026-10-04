import { render } from 'preact';
import { initTheme } from './hooks/useTheme';
import { App } from './app';
import { ErrorBoundary } from './components/ui/ErrorBoundary';

initTheme();
render(
	<ErrorBoundary scope="app">
		<App />
	</ErrorBoundary>,
	document.getElementById('app')!,
);
