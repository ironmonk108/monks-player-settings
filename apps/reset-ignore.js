const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

export class ResetIgnore extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        id: "player-settings-resetignore",
        tag: "form",
        classes: ["adjust-price"],
        sheetConfig: false,
        window: {
            contentClasses: ["standard-form"],
        },
        actions: {
        },
        position: { },
        form: {
            closeOnSubmit: true,
            submitOnClose: false,
            submitOnChange: false
        }
    };

    static PARTS = {
        main: {
            root: true,
            template: "modules/monks-player-settings/templates/resetignore.html"
        }
    };

    static async resetIgnore(app) {
        await game.user.unsetFlag("monks-player-settings", "ignore-id");
        app.close({ force: true });

        window.location.reload();
    }
}

Hooks.on("renderResetIgnore", ResetIgnore.resetIgnore);