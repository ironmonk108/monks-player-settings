import { MonksPlayerSettings, i18n, setting, log } from "../monks-player-settings.js";

export class MonksSettingsConfig extends foundry.applications.settings.SettingsConfig {
    constructor(...args) {
        super(...args);

        this.userId = game.user.id;
    }

    static DEFAULT_OPTIONS = {
        tag: "form",
        form: {
            handler: MonksSettingsConfig._onSubmit
        }
    }

    /*
    static PARTS = {
        main: {
            template: "modules/monks-player-settings/templates/main.hbs"
        }
    };
    */

    async _prepareContext(options) {
        if (game.user.isGM) {
            this.clientSettings = {};
            this.gmchanges = {};

            let users = game.users.filter(u => u.id != game.user.id);

            for (let user of users) {
                try {
                    let cs = foundry.utils.getProperty(user, "flags.monks-player-settings.client-settings");
                    this.clientSettings[user.id] = cs ? foundry.utils.flattenObject(JSON.parse(cs)) : null;
                    this.gmchanges[user.id] = JSON.parse(foundry.utils.getProperty(user, "flags.monks-player-settings.gm-settings") || "{}");
                } catch { }
            }

            this.gmchanges["players"] = JSON.parse(foundry.utils.getProperty(game.user, "flags.monks-player-settings.players-settings") || "{}");
        }

        let context = super._prepareContext(options);
        context.user = game.users.get(this.userId);
        /*
        context.userId = userId;

        context.players = game.users.reduce((obj, u) => {
            obj[u.id] = u.name;
        }, { players: "-- All Players --"});
        */

        return context;
    }

    _prepareCategoryData() {
        if (!game.user.isGM)
            return super._prepareCategoryData();

        const gs = game.settings;
 
        const categories = {};
        const getCategory = namespace => {
            const { id, label } = this._categorizeEntry(namespace);
            return categories[id] ??= { id, label, entries: [] };
        };

        //find the settings of the users we're currently looking at
        this.clientdata = {};
        let clientSettings = this.userId != game.user.id ? this.clientSettings[this.userId] || {} : {};
        let gmchanges = this.userId != game.user.id ? this.gmchanges[this.userId] || {} : {};

        const clientCanConfigure = this.userId == "players" ? false : game.users.get(this.userId).can("SETTINGS_MODIFY");

        let ignoreModules = MonksPlayerSettings.getExcludeModules();

        // Classify all menus
        const canConfigure = game.user.can("SETTINGS_MODIFY");
        for (let menu of gs.menus.values()) {
            // Exclude the setting from modules that are ignored
            if (this.userId != game.user.id && ignoreModules.includes(menu.namespace)) continue;

            if (menu.restricted && !canConfigure) continue;
            if ((menu.key === "core.permissions") && !game.user.hasRole("GAMEMASTER")) continue;
            const category = getCategory(menu.namespace);
            category.entries.push({
                key: menu.key,
                icon: menu.icon,
                label: menu.name,
                hint: menu.hint,
                menu: true,
                buttonText: menu.label
            });
        }

        // Classify all settings
        for (let setting of gs.settings.values()) {
            // Exclude the setting from modules that are ignored
            if (this.userId != game.user.id && ignoreModules.includes(setting.namespace)) continue;

            // Exclude settings the user cannot change
            if (!setting.config || (!clientCanConfigure && (setting.scope === CONST.SETTING_SCOPES.WORLD))) continue;

            let originalValue;
            try {
                originalValue = (this.userId != game.user.id ? this.getClientSetting(setting.namespace, setting.key, clientSettings) : game.settings.get(setting.namespace, setting.key));
            } catch (err) {
                log(`Settings detected issue ${setting.namespace}.${setting.key}`, err);
            }

            const data = {
                label: setting.value,
                value: (this.userId != game.user.id ? (gmchanges[setting.namespace] && gmchanges[setting.namespace][setting.key]) ?? originalValue : originalValue),
                originalValue,
                menu: false
            };

            // Define a DataField for each setting not originally defined with one
            const fields = foundry.data.fields;
            if (setting.type instanceof fields.DataField) {
                data.field = setting.type;
            }
            else if (setting.type === Boolean) {
                data.field = new fields.BooleanField({ initial: setting.default ?? false });
            }
            else if (setting.type === Number) {
                const { min, max, step } = setting.range ?? {};
                data.field = new fields.NumberField({
                    required: true,
                    choices: setting.choices,
                    initial: setting.default,
                    min,
                    max,
                    step
                });
            }
            else if (setting.filePicker) {
                const categories = {
                    audio: ["AUDIO"],
                    folder: [],
                    font: ["FONT"],
                    graphics: ["GRAPHICS"],
                    image: ["IMAGE"],
                    imagevideo: ["IMAGE", "VIDEO"],
                    text: ["TEXT"],
                    video: ["VIDEO"]
                }[setting.filePicker] ?? Object.keys(CONST.FILE_CATEGORIES).filter(c => c !== "HTML");
                if (categories.length) {
                    data.field = new fields.FilePathField({ required: true, blank: true, categories });
                }
                else {
                    data.field = new fields.StringField({ required: true }); // Folder paths cannot be FilePathFields
                    data.folderPicker = true;
                }
            }
            else {
                data.field = new fields.StringField({ required: true, choices: setting.choices });
            }
            data.field.name = `${setting.namespace}.${setting.key}`;
            data.field.label ||= game.i18n.localize(setting.name ?? "");
            data.field.hint ||= game.i18n.localize(setting.hint ?? "");

            // Categorize setting
            const category = getCategory(setting.namespace);
            category.entries.push(data);

            if (setting.config && setting.scope == "client")
                this.clientdata[setting.id] = setting.originalValue;
        }

        this.clientdata = MonksPlayerSettings.mergeDefaults(MonksPlayerSettings.cleanSetting(foundry.utils.expandObject(this.clientdata)));

        return categories;
    }

    _categorizeEntry(namespace) {
        switch (namespace) {
            case "core":
                return { id: "core", label: game.i18n.localize("PACKAGECONFIG.TABS.core") };
            case game.system.id:
                return { id: "system", label: game.system.title };
            default: {
                const module = game.modules.get(namespace);
                return module
                    ? { id: module.id, label: module.title }
                    : { id: "unmapped", label: game.i18n.localize("PACKAGECONFIG.TABS.unmapped") };
            }
        }
    }

    /*
    async _onRender(context, options) {
        $(".viewed-user", this.element).on("change", this.changeUserSettings.bind(this))
    }
    */

    getClientSetting(namespace, key, storage = {}) {
        if (!game.user.isGM)
            return super.getClientSetting(namespace, key, storage);

        if (!namespace || !key) throw new Error("You must specify both namespace and key portions of the setting");
        key = `${namespace}.${key}`;
        if (!game.settings.settings.has(key)) throw new Error("This is not a registered game setting");

        // Get the setting and the correct storage interface
        const setting = game.settings.settings.get(key);

        // Get the setting value
        let value = storage[key];
        if (value) {
            try {
                value = JSON.parse(value);
            } catch (err) {
                value = String(value);
            }
        }
        else value = (setting.default || "");

        // Cast the value to a requested type
        if (setting.type && MonksPlayerSettings.PRIMITIVE_TYPES.includes(setting.type)) {
            if (!(value instanceof setting.type)) {
                if (MonksPlayerSettings.PRIMITIVE_TYPES.includes(setting.type)) value = setting.type(value);
                else {
                    const isConstructed = setting.type?.prototype?.constructor === setting.type;
                    value = isConstructed ? new setting.type(value) : setting.type(value);
                }
            }
        }
        return value;
    }

    async changeUserSettings(ev) {
        if (!game.user.isGM)
            return super.changeUserSettings(ev);

        this.userId = $(ev.currentTarget).val();

        this.render();

        if (this.userId != "players") {
            // if the viewing user has nothing saved yet, warn the GM that they could be overwriting changes made by the player
            let userSaved = (game.users.get(this.userId).flags["monks-player-settings"] !== undefined)
            if (!userSaved)
                ui.notifications.error("Warning: Player has not saved their settings while Monk's Player Settings has been active.  These changes could overwrite some of their settings that you're not intending to change.", { permanent: true });
        }
    }

    async _onSubmitForm(formConfig, event) {
        //only close if we're looking at our own data
        formConfig.closeOnSubmit = (game.user.id === this.userId);
        return super._onSubmitForm(formConfig, event);
    }

    async originalSubmit(_event, _form, formData) {
        let requiresClientReload = false;
        let requiresWorldReload = false;
        for (const [key, value] of Object.entries(formData.object)) {
            const setting = game.settings.settings.get(key);
            if (!setting) continue;
            const priorValue = game.settings.get(setting.namespace, setting.key, { document: true })?._source.value;
            let newSetting;
            try {
                newSetting = await game.settings.set(setting.namespace, setting.key, value, { document: true });
            } catch (error) {
                ui.notifications.error(error);
            }
            if (priorValue === newSetting?._source.value) continue; // Compare JSON strings
            requiresClientReload ||= (setting.scope !== CONST.SETTING_SCOPES.WORLD) && setting.requiresReload;
            requiresWorldReload ||= (setting.scope === CONST.SETTING_SCOPES.WORLD) && setting.requiresReload;
        }
        if (requiresClientReload || requiresWorldReload) {
            await this.constructor.reloadConfirm({ world: requiresWorldReload });
        }
    }

    static async _onSubmit(event, form, formData) {
        if (game.user.id == this.userId) {
            //this is just a regular update
            await this.originalSubmit(event, form, formData);

            //save a copy of the client settings to user data
            if (setting("sync-settings"))
                MonksPlayerSettings.saveSettings();
        } else {
            // Need to compare the formData with the client values
            let settings = MonksPlayerSettings.mergeDefaults(MonksPlayerSettings.cleanSetting(foundry.utils.expandObject(foundry.utils.duplicate(formData.object))));
            
            if (this.userId == "players") {
                let gameSettings = [...game.settings.settings].filter(([k, v]) => v.config && v.scope == "client").map(([k, v]) => v);

                let diff = foundry.utils.diffObject(this.clientdata, settings);
                await game.user.update({ "flags.monks-player-settings.players-settings": JSON.stringify(diff) });

                for (let user of game.users.filter(u => !u.isGM)) {
                    let clientSettings = this.clientSettings[user.id];
                    let clientData = {};

                    if (clientSettings) {
                        for (let s of gameSettings) {
                            let originalValue;
                            try {
                                originalValue = this.getClientSetting(s.namespace, s.key, clientSettings);
                            } catch (err) {
                                log(`Settings detected issue ${s.namespace}.${s.key}`, err);
                            }
                            clientData[`${s.namespace}.${s.key}`] = originalValue;
                        }
                        clientData = MonksPlayerSettings.cleanSetting(foundry.utils.expandObject(clientData));
                    } else
                        clientData = this.clientdata;
                    
                    let diff = foundry.utils.diffObject(clientData, settings);

                    await user.update({ "flags.monks-player-settings.gm-settings": JSON.stringify(diff) });
                }
                ui.notifications.info(`Settings have been saved for all players and will be updated the next time each player logs in.`);
            } else {
                let diff = foundry.utils.diffObject(this.clientdata, settings);
                if (Object.keys(diff).length) {
                    await game.users.get(this.userId).update({ "flags.monks-player-settings.gm-settings": JSON.stringify(diff) });

                    let player = game.users.get(this.userId);
                    ui.notifications.info(`Settings have been saved for ${player.name}${!player.active ? " and will be updated the next time the player logs in." : ""}`);
                } else {
                    let player = game.users.get(this.userId);
                    ui.notifications.info(`No settings have been changed for ${player.name}`);
                }
            }
        }
    }

    async close(options) {
        this.userId = game.user.id;
        return super.close(options);
    }
}

export const WithMonksSettingsConfig = (SettingsConfig) => {
    const constructorName = "MonksSettingsConfig";
    Object.defineProperty(MonksSettingsConfig.prototype.constructor, "name", { value: constructorName });
    return MonksSettingsConfig;
};

Hooks.on('renderSettingsConfig', (app, html) => {
    if (game.user.isGM && $("#mps-view-group", html).length == 0) {
        let userId = (app.userId || game.user.id);

        let select = $('<select>')
            .addClass("viewed-user")
            .append('<option value="players">-- All Players --</option>')
            .append(game.users.map(u => { return `<option value="${u.id}"${u.id == userId ? ' selected' : ''}>${u.name}</option>` }))
            .on('change', app.changeUserSettings.bind(app));

        let div = $('<div>')
            .attr("id", "mps-view-group")
            .addClass('flexrow')
            .append($('<label>').html('View settings for Player:'))
            .append($('<div>').addClass('form-fields').append(select));

        $('.window-content .main', html).prepend(div);
    }
})