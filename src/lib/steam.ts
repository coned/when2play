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
