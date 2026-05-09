import { registerSettings } from "./settings.js";
import { WithMonksSettingsConfig, MonksSettingsConfig } from "./apps/settings-config.js"

export let debugEnabled = 0;

export let debug = (...args) => {
    if (debugEnabled > 1) console.log("DEBUG: monks-player-settings | ", ...args);
};
export let log = (...args) => console.log("monks-player-settings | ", ...args);
export let warn = (...args) => {
    if (debugEnabled > 0) console.warn("monks-player-settings | ", ...args);
};
export let error = (...args) => console.error("monks-player-settings | ", ...args);
export let i18n = key => {
    return game.i18n.localize(key);
};
export let setting = key => {
    return game.settings.get("monks-player-settings", key);
};

export class MonksPlayerSettings {
    static PRIMITIVE_TYPES = [String, Number, Boolean, Array, Symbol, BigInt];

    static init() {

        MonksPlayerSettings.SOCKET = "module.monks-player-settings";

        registerSettings();

        Object.defineProperty(foundry.helpers.ClientSettings.prototype, "sheet", {
            get: function () {
                if (!this._sheet) {
                    let settingCls = WithMonksSettingsConfig(game.settings._sheet?.constructor || foundry.applications.settings.SettingsConfig);
                    this._sheet = new settingCls();
                }
                return this._sheet;
            }
        })
    }

    static async ready() {
        if (game.modules.get("settings-extender")?.active) {
            let settingCls = WithMonksSettingsConfig(game.settings._sheet?.constructor || foundry.applications.settings.SettingsConfig);
            game.settings._sheet = new settingCls(game.settings.settings);

            window.setTimeout(() => {
                if (!(game.settings._sheet instanceof MonksSettingsConfig)) {
                    let settingCls = WithMonksSettingsConfig(game.settings._sheet?.constructor || foundry.applications.settings.SettingsConfig);
                    game.settings._sheet = new settingCls(game.settings.settings);
                }
            }, 500);
        }

        if (game.user.flags == undefined || game.user.flags['monks-player-settings'] == undefined)
            MonksPlayerSettings.saveSettings(); //save what I've got

        MonksPlayerSettings.checkSettings();
    }

    static getExcludeModules() {
        let ignore = setting("ignore-modules").split(",").map(m => m.trim());
        ignore.push("monks-player-settings");
        return ignore;
    }

    static async saveSettings() {
        let clientSettings = this.cleanSetting(foundry.utils.expandObject(foundry.utils.duplicate(game.settings.storage.get("client"))));
        await game.user.setFlag('monks-player-settings', 'client-settings', JSON.stringify(clientSettings));

        let saveId = game.user.getFlag('monks-player-settings', 'save-id') || 0;
        game.user.setFlag('monks-player-settings', 'save-id', ++saveId);
    }

    static cleanSetting(settings) {
        //delete settings.core;
        //delete settings[game.system.id];
        delete settings["monks-player-settings"];
        let ignore = MonksPlayerSettings.getExcludeModules();

        for (let [module, s] of Object.entries(settings)) {
            if (ignore.includes(module))
                delete settings[module];
            else {
                if (typeof s === "object") {
                    let _s = foundry.utils.flattenObject(s);

                    let mod = game.modules.get(module);
                    if (!mod && module !== "core" && module !== game.system.id)
                        delete settings[module];
                    else {
                        for (let [name, value] of Object.entries(_s)) {
                            let key = `${module}.${name}`;
                            if (["core.performanceMode"].includes(key)) {
                                delete _s.name;
                                continue;
                            }
                            let config = game.settings.settings.get(key);
                            if (!config || !config.config) {
                                try {
                                    delete _s[name];
                                } catch (err) {
                                    log(err);
                                }
                            } else {
                                try {
                                    value = config.type(JSON.parse(value));
                                } catch (err) {
                                    value = String(value);
                                }
                                if (config.default === value) {
                                    try {
                                        delete s[name];
                                    } catch (err) {
                                        log(err);
                                    }
                                }
                            }
                        }
                        if (Object.keys(settings[module]).length === 0)
                            delete settings[module];
                    }
                } else
                    delete settings[module];
            }
        }

        return settings;
    }

    static mergeDefaults(settings) {
        let defaults = {};
        let ignore = MonksPlayerSettings.getExcludeModules();
        for (let setting of game.settings.settings.values()) {
            if (setting.scope === "client" && setting.config && MonksPlayerSettings.PRIMITIVE_TYPES.includes(setting.type) && !ignore.includes(setting.namespace)) {
                let key = `${setting.namespace}.${setting.key}`;
                defaults[key] = setting.default;
            }
        }

        return foundry.utils.mergeObject(foundry.utils.expandObject(defaults), settings);
    }

    static makeReadable(diff = {}) {
        let result = [];

        let client = game.settings.storage.get("client");
        let ignore = MonksPlayerSettings.getExcludeModules();

        for (let [moduleId, changes] of Object.entries(diff)) {
            let _changes = foundry.utils.flattenObject(changes);
            let mod = game.modules.get(moduleId);

            // If this module no longer exists, skip it
            if ((moduleId !== "core" && moduleId !== game.system.id && !mod) || ignore.includes(moduleId)) continue;

            let title = moduleId === "core" ? "Core" : (moduleId === game.system.id ? game.system.title : mod.title);
            let data = { id: moduleId, name: title, changes: [] };

            for (let [settingId, value] of Object.entries(_changes)) {
                let key = `${moduleId}.${settingId}`;
                let config = game.settings.settings.get(key);

                // If this setting no longer exists, skip it
                if (!config || !config.config)
                    continue;

                let oldvalue = client[key] ?? config.default;
                try {
                    oldvalue = config.type(JSON.parse(oldvalue));
                } catch (err) { }
                let newvalue = value;
                try {
                    newvalue = config.type(JSON.parse(value));
                } catch (err) { }

                if (typeof oldvalue == "object") {
                    try { oldvalue = JSON.stringify(oldvalue) } catch { }
                }

                if (typeof newvalue == "object") {
                    try { newvalue = JSON.stringify(newvalue) } catch { }
                }

                if (oldvalue == newvalue)
                    continue;

                data.changes.push({ id: settingId, name: i18n(config.name), oldvalue: oldvalue, newvalue: newvalue, use: 'newvalue'});
            }

            if (data.changes.length > 0)
                result.push(data);
        }

        return result;
    }

    static getDifferences() {
        //if there are differences in the stored settings request to sync
        let client = this.mergeDefaults(this.cleanSetting(foundry.utils.expandObject(foundry.utils.duplicate(game.settings.storage.get("client")) || {})));
        let stored = game.user.getFlag('monks-player-settings', 'client-settings');
        if (stored !== undefined) {
            try {
                stored = JSON.parse(stored);
            } catch {
                stored = null;
            }
            stored = this.mergeDefaults(this.cleanSetting(foundry.utils.duplicate(stored || {})));
            //also need to add all the defaults so that the diff picks up on thos changes
            return foundry.utils.diffObject(client, stored);
        }

        return {};
    }

    static ignoreChanges() {
        let saveId = game.user.getFlag('monks-player-settings', 'save-id') || 0;
        let ignoreId = game.user.getFlag('monks-player-settings', 'ignore-id');

        return !(ignoreId == undefined || saveId > ignoreId);
    }

    static async checkSettings() {
        let refresh = false;

        if (setting("sync-settings") && !this.ignoreChanges()) {
            //if there are differences in the stored settings request to sync
            let diff = {};
            let storedChanged = false;
            let client = this.mergeDefaults(this.cleanSetting(foundry.utils.expandObject(foundry.utils.duplicate(game.settings.storage.get("client")) || {})));
            let stored = game.user.getFlag('monks-player-settings', 'client-settings');
            if (stored !== undefined) {
                try {
                    stored = JSON.parse(stored);
                } catch {
                    stored = null;
                }
                stored = this.mergeDefaults(this.cleanSetting(foundry.utils.duplicate(stored || {})));
                //also need to add all the defaults so that the diff picks up on thos changes
                diff = foundry.utils.diffObject(client, stored);
            }

            let data = this.makeReadable(diff);

            if (!foundry.utils.isEmpty(data)) {
                let content = await foundry.applications.handlebars.renderTemplate("./modules/monks-player-settings/templates/differences.html", { differences: data });
                await foundry.applications.api.DialogV2.wait({
                    window: {
                        title: "Difference in client settings detected",
                    },
                    position: { width: 600 },
                    content: content,
                    buttons: [
                        {
                            icon: "fas fa-check",
                            action: "yes",
                            label: game.i18n.localize("Yes"),
                            callback: () => {
                                let ignore = MonksPlayerSettings.getExcludeModules();
                                for (let module of data) {
                                    if (ignore.includes(module.id))
                                        continue;
                                    for (let change of module.changes) {
                                        let key = `${module.id}.${change.id}`;
                                        if (change.use == "newvalue" || change.use == "oldvalue") {
                                            let value = change[change.use];
                                            log(`Setting Sync: ${key}, "${window.localStorage[key]}" -> "${value}"`);

                                            if (change.use == "newvalue") {
                                                window.localStorage.setItem(key, value);

                                                //do any of the differences call a function?  Then refresh the browser
                                                const setting = game.settings.settings.get(key);
                                                if (setting?.onChange instanceof Function || setting?.requiresReload) refresh = true;
                                            } else {
                                                stored[module.id][change.id] = value;
                                                storedChanged = true;
                                            }
                                        } else
                                            log(`Setting Sync: Ignoring ${key}`);
                                    }
                                }
                            }
                        },
                        {
                            label: "Ignore",
                            action: "ignore",
                            callback: () => {
                                let saveId = game.user.getFlag('monks-player-settings', 'save-id') || 0;
                                game.user.setFlag('monks-player-settings', 'ignore-id', saveId);
                            }
                        },
                        {
                            icon: "fas fa-times",
                            label: game.i18n.localize("No"),
                            action: "no"
                        },
                    ],
                    render: (event, dialog) => {
                        $('.setting-oldvalue,.setting-newvalue', dialog.element).on("click", (ev) => {
                            let use = ev.currentTarget.dataset.use;
                            let li = ev.currentTarget.closest(".setting-group");
                            let id = li.dataset.id;
                            let settingId = li.dataset.setting;

                            let item = data.find(i => i.id == id);
                            if (item) {
                                let setting = item.changes.find(s => s.id == settingId);
                                if (setting) {
                                    setting.use = setting.use == use ? "none" : use;
                                    $('.setting-oldvalue', li).toggleClass("active", setting.use == "oldvalue");
                                    $('.setting-newvalue', li).toggleClass("active", setting.use == "newvalue");
                                    $('.setting-direction i', li).attr("class", `fas ${setting.use == "oldvalue" ? "fa-chevron-left" : (setting.use == "newvalue" ? "fa-chevron-right" : "fa-not-equal")}`);
                                }
                            }
                        })
                    },
                    close: () => { return true; }
                });

                if (storedChanged) {
                    game.user.setFlag('monks-player-settings', 'client-settings', JSON.stringify(stored));
                }
            }
        }

        //check to see if there are GM changes
        //and if the webpage needs to be refreshed
        if (await MonksPlayerSettings.refreshSettings() || refresh)
            MonksPlayerSettings.checkRefresh();
    }

    static async refreshSettings() {
        let refresh = false;

        //if there are GM changes then prompt to update with those changes
        if (game.user.getFlag('monks-player-settings', 'gm-settings') != undefined) {
            let gmsettings = game.user.getFlag('monks-player-settings', 'gm-settings');
            try {
                gmsettings = JSON.parse(gmsettings);
            } catch {
                gmsettings = {};
            }
            if (Object.keys(gmsettings).length == 0) {
                game.user.unsetFlag('monks-player-settings', 'gm-settings');
                return;
            }

            for (let [namespace, values] of Object.entries(gmsettings)) {
                for (let [k, v] of Object.entries(values)) {
                    let key = `${namespace}.${k}`;
                    window.localStorage.setItem(key, v);

                    console.log(`GM Update Setting: ${key}, "${v}"`);

                    //if the webpage needs to be refreshed then return true
                    const setting = game.settings.settings.get(key);
                    if (setting && (setting.onChange instanceof Function || setting.requiresReload)) refresh = true;
                }
            }

            //clear the gm setting changes
            await game.user.unsetFlag('monks-player-settings', 'gm-settings');

            //save a new copy of the client settings
            let clientSettings = this.cleanSetting(foundry.utils.expandObject(foundry.utils.duplicate(game.settings.storage.get("client"))));
            await game.user.setFlag('monks-player-settings', 'client-settings', JSON.stringify(clientSettings));

            ui.notifications.info("GM has made changes to your client settings");
        }

        return refresh;
    }

    static checkRefresh() {
        Dialog.confirm({
            title: `Browser refresh`,
            content: `<h4>Some of the settings changed required Foundry to be restarted</h4><p>Reload the browser?</p>`,
            yes: () => {
                location.reload();
            }
        });
    }
}

Hooks.once('init', async function () {
    MonksPlayerSettings.init();
});

Hooks.once('ready', async function () {
    MonksPlayerSettings.ready();
});

Hooks.on('updateUser', async function (user, data, options) {
    //If the GM has changed settings and the player is currently active, then refresh settings
    if (data.flags
        && data.flags["monks-player-settings"]
        && data.flags["monks-player-settings"]["gm-settings"]
        && game.user.id == user.id
    ) {
        if (await MonksPlayerSettings.refreshSettings())
            MonksPlayerSettings.checkRefresh();
    }

    //if this is the GM then update to match changes player made
    if (game.user.isGM
        && data.flags
        && data.flags["monks-player-settings"]
        && data.flags["monks-player-settings"]["client-settings"]
        && $('#client-settings').length
        && $('#client-settings .viewed-user').val() == user.id)
    {
        console.log('updating user', user, data, options);
        try {
            let settings = JSON.parse(data.flags["monks-player-settings"]["client-settings"]);
            for (let [k, v] of Object.entries(settings)) {
                for (let [name, value] of Object.entries(v)) {
                    let key = `${k}.${name}`;
                    let val = value;
                    try {
                        val = JSON.parse(val);
                    } catch (err) {
                        val = String(val);
                    }
                    if (typeof val == "boolean")
                        $(`#client-settings [name="${key}"]`).prop("checked", val);
                    else
                        $(`#client-settings [name="${key}"]`).val(val);
                }
            }
        } catch {}
    }
});
