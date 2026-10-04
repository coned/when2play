export interface SteamSearchResult {
	app_id: string;
	name: string;
	image_url: string;
}

interface SteamAppDetails {
	name: string;
	header_image: string;
}

export async function lookupSteamApp(appId: string): Promise<SteamAppDetails | null> {
	const url = `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appId)}`;
	const res = await fetch(url);

	if (!res.ok) return null;

	const data = await res.json<Record<string, { success?: boolean; data?: SteamAppDetails } | undefined>>();
	const appData = data[appId];

	if (!appData?.success || !appData.data) return null;

	return {
		name: appData.data.name,
		header_image: appData.data.header_image,
	};
}

const NAMED_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: '\u00a0',
	trade: '\u2122',
	reg: '\u00ae',
	copy: '\u00a9',
	ndash: '\u2013',
	mdash: '\u2014',
	hellip: '\u2026',
	lsquo: '\u2018',
	rsquo: '\u2019',
	ldquo: '\u201c',
	rdquo: '\u201d',
};

/**
 * Decode HTML character references in text taken from Steam's HTML: named ones
 * from a common subset and every numeric one (&#38; and &#x26;). Unknown or
 * invalid references are kept as written.
 */
export function decodeHtmlEntities(text: string): string {
	return text.replace(/&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (whole, ref: string) => {
		if (ref[0] === '#') {
			const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
			if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return whole;
			return String.fromCodePoint(code);
		}
		return NAMED_ENTITIES[ref] ?? NAMED_ENTITIES[ref.toLowerCase()] ?? whole;
	});
}

/**
 * Search Steam store by partial game name.
 * Parses the HTML suggestion response from Steam's search endpoint.
 */
export async function searchSteamApps(query: string): Promise<SteamSearchResult[]> {
	const url = `https://store.steampowered.com/search/suggest?term=${encodeURIComponent(query)}&f=games&cc=us&realm=1&l=english`;
	const res = await fetch(url);

	if (!res.ok) return [];

	const html = await res.text();
	if (!html.trim()) return [];

	const results: SteamSearchResult[] = [];
	// Parse each <a> element with data-ds-appid
	const appIdRegex = /data-ds-appid="(\d+)"/g;
	const nameRegex = /<div class="match_name">(.*?)<\/div>/g;
	const imgRegex = /<img[^>]+src="([^"]+)"/g;

	const appIds = [...html.matchAll(appIdRegex)].map((m) => m[1]);
	const names = [...html.matchAll(nameRegex)].map((m) => m[1]);
	const imgs = [...html.matchAll(imgRegex)].map((m) => m[1]);

	for (let i = 0; i < Math.min(appIds.length, names.length, 10); i++) {
		results.push({
			app_id: appIds[i],
			name: decodeHtmlEntities(names[i]).trim(),
			image_url: imgs[i] || '',
		});
	}

	return results;
}
