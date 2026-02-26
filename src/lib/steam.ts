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

	const data = await res.json();
	const appData = data[appId];

	if (!appData?.success || !appData.data) return null;

	return {
		name: appData.data.name,
		header_image: appData.data.header_image,
	};
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
			name: names[i],
			image_url: imgs[i] || '',
		});
	}

	return results;
}
