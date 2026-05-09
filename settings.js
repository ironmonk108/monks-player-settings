import { ResetIgnore } from "./apps/reset-ignore.js";
import { MonksPlayerSettings, i18n } from "./monks-player-settings.js";

export const registerSettings = function () {
	// Register any custom module settings here
	let modulename = "monks-player-settings";

	game.settings.registerMenu(modulename, 'resetIgnore', {
		name: 'Reset ignore changes',
		label: 'Reset ignore changes',
		hint: 'If you clicked to ignore updates until the next change, click this to get the change dialog back.',
		icon: 'fas fa-undo',
		restricted: false,
		type: ResetIgnore
	});
	
	game.settings.register(modulename, "sync-settings", {
		name: i18n("MonksPlayerSettings.sync-settings.name"),
		hint: i18n("MonksPlayerSettings.sync-settings.hint"),
		config: true,
		scope: "client",
		default: true,
		type: Boolean
	});

	game.settings.register(modulename, "ignore-modules", {
		name: i18n("MonksPlayerSettings.ignore-modules.name"),
		hint: i18n("MonksPlayerSettings.ignore-modules.hint"),
		config: true,
		scope: "world",
		default: "fuzzy-foundry",
		type: String
	});
};
