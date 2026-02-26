import { render } from 'preact';
import { initTheme } from './hooks/useTheme';
import { App } from './app';

initTheme();
render(<App />, document.getElementById('app')!);
