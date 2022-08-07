//https://hackmd.io/@akrigline/ByHFgUZ6u/%2FyatbVbgzSxSMqHl5qoegpA
Hooks.once('init', async function() {
    ConditionalMacros.initialize()
    game.modules.get(ConditionalMacros.ID).api = {
        rollMacro: ConditionalMacros.showRollDialogue.bind(ConditionalMacros)
    }
});

Hooks.once('ready', async function() {
    ConditionalMacros.log(false, "Hello from conditional-macros!")
});

Hooks.on('renderHotbar', async function(hotbar, html, row) {
    ConditionalMacros.log(false, "Rendering our button")
    const tooltip = game.i18n.localize('CONDITIONAL-MACROS.button-title');
    let toAdd = $(`<button type='button' title="${tooltip}" style="pointer-events: all; cursor: pointer"><i class='fas fa-code-branch' style="margin-right: 0"></i></button>`)
    toAdd.click((event) => {
        const userId = game.userId
        ConditionalMacros.conditionalList.render(true, {userId});
    })
    html.prepend(toAdd)
})

Hooks.once('devModeReady', ({ registerPackageDebugFlag }) => {
    registerPackageDebugFlag(ConditionalMacros.ID);
});

class ConditionalMacros {
    static ID = "conditional-macros"

    static FLAGS = {
        MACROS: 'cmacros'
    }

    static TEMPLATES = {
        LIST: `modules/${this.ID}/templates/macroList.hbs`,
        EDITOR: `modules/${this.ID}/templates/macroEditor.hbs`,
        ROLLER: `modules/${this.ID}/templates/macroRoller.hbs`,
    }

    //https://hackmd.io/@akrigline/ByHFgUZ6u/%2FojFSOsrNTySh9HbzTE3Orw
    static log(force, ...args) {  
        const shouldLog = force || game.modules.get('_dev-mode')?.api?.getPackageDebugValue(this.ID);
    
        if (shouldLog) {
          console.log(this.ID, '|', ...args);
        }
    }

    static initialize() {
        this.conditionalList = new ConditionalList()
        this.conditionalMacroEditor = new ConditionalMacroEditor()
    }

    static async showRollDialogue(macroID) {
        let macro = ConditionalMacroStorage.allMacros[macroID]
        let buttons
        if (macro.isDamage) {
            buttons = {
                critical: {
                    label: game.i18n.localize("CONDITIONAL-MACROS.critical-damage"),
                    callback: this.dialogueCallback.bind(this, {critical: true})
                },
                normal: {
                    label: game.i18n.localize("CONDITIONAL-MACROS.normal-damage"),
                    callback: this.dialogueCallback.bind(this, {critical: false})
                }
            }
        } else {
            buttons = {
                disadv: {
                    label: game.i18n.localize("CONDITIONAL-MACROS.disadv-roll"),
                    callback: this.dialogueCallback.bind(this, {advantage: -1})
                },
                normal: {
                    label: game.i18n.localize("CONDITIONAL-MACROS.normal-roll"),
                    callback: this.dialogueCallback.bind(this, {advantage: 0})
                },
                adv: {
                    label: game.i18n.localize("CONDITIONAL-MACROS.adv-roll"),
                    callback: this.dialogueCallback.bind(this, {advantage: 1})
                }
            }
        }
        let content = await renderTemplate(this.TEMPLATES.ROLLER, {macro})
        new Dialog({
            title: macro.name,
            content: content,
            buttons: buttons
        }).render(true)
    }

    static dialogueCallback(options, html) {
        let macroID = html.find("[data-macro-id]").data().macroId
        let flags = {}
        html.find("[data-component-id]").each(function (index) {
            flags[$(this).data().componentId] = ($(this).find("input:checked").length > 0)
        })
        this.rollMacro(macroID, flags, options)
    }

    //Rolls a macro in the chat.
    // Flags is an object mapping component IDs to booleans representing whether or not to include them
    // Options is, at this point, just for advantage and disadvantage, or for crits
    static rollMacro(macroID, flags, options) {
        let macro = ConditionalMacroStorage.allMacros[macroID]
        let rollString = ""
        for (let i in flags) {
            if (!flags[i]) continue
            //Previously had parentheses, but IDK if that works anymore
            let toAdd = `${macro.components[i].roll}`
            if (!macro.isDamage) {
                if (options.advantage == 1 && macro.components[i].advAffects) {
                    //Remove any number of dice, and make it 2, keep highest
                    toAdd = toAdd.replace(/\d+d/g, "d")
                    toAdd = toAdd.replace(/(d\d+)/g, "2$&kh")
                } else if (options.advantage == -1 && macro.components[i].advAffects) {
                    //Remove any number of dice, and make it 2, keep lowest
                    toAdd = toAdd.replace(/\d+d/g, "d")
                    toAdd = toAdd.replace(/(d\d+)/g, "2$&kl")
                }
            }
            rollString += toAdd
            if (macro.components[i].name) {
                rollString += `[${macro.components[i].name}]`
            }
            rollString += " + "
        }
        rollString = rollString.replace(/ \+ $/, "")
        this.log(false, rollString)
        let roll = new Roll(rollString)
        if (CONFIG?.Dice?.DamageRoll && macro.isDamage) {
            rollString = rollString.replace(/(?<!\d)d/g, "1d")
            roll = new CONFIG.Dice.DamageRoll(rollString, null, {
                critical: options.critical,
                multiplyNumeric: game.settings.get("dnd5e", "criticalDamageModifiers"),
                powerfulCritical: game.settings.get("dnd5e", "criticalDamageMaxDice")
            })
        }
        roll.evaluate().then(() => {
            roll.render().then((result) => {
                //TODO: Do the thing where we pool damage types
                ChatMessage.create({content: result})
            })
        })
    }
}

/**
 * A single component of our conditional macro. For example, Base Damage, Dex Bonus, and Sneak Attack would all be part of this.
 * @typedef {Object} CMacroComponent
 * @property {string} id - The ID of this component
 * @property {string} name - The name of this component
 * @property {string} type - The type of the damage, if any. If specified, will roll in separate pools for each type.
 * @property {string} roll - The dice to roll, or number to add directly
 * @property {boolean} defaultOn - Whether this component defaults to being on in the rolling menu
 * @property {boolean} advAffects - Whether this component is affected by advantage
 */

/**
 * A single conditional macro.
 * @typedef {Object} CMacro
 * @property {string} id - The ID of this macro
 * @property {string} userID - The ID of the user this macro is associated with
 * @property {string} name - The name of this macro
 * @property {boolean} isDamage - Whether this macro is for damage (in which case it'll use a DamageRoll)
 * @property {Object[CMacroComponent]} components - The components contained in this macro
 */

class ConditionalMacroStorage {
    //https://hackmd.io/@akrigline/ByHFgUZ6u/%2FhxB4-nbQRCyPDbPCsqTupw
    static getUserMacros(userID) {
        return game.users.get(userID)?.getFlag(ConditionalMacros.ID, ConditionalMacros.FLAGS.MACROS)
    }

    static get allMacros() {
        const allMacros = game.users.reduce((accumulator, user) => {
            const userMacros = this.getUserMacros(user.id)

            return {
                ...accumulator,
                ...userMacros
            }
        }, {})

        return allMacros
    }

    static createMacro(userID, name) {
        const newMacro = {
            id: foundry.utils.randomID(16),
            userID: userID,
            name: name,
            components: {}
        }

        const toAdd = {
            [newMacro.id]: newMacro
        }

        return game.users.get(userID)?.setFlag(ConditionalMacros.ID, ConditionalMacros.FLAGS.MACROS, toAdd)
    }

    static updateMacro(updatedMacro) {
        const updated = {
            [updatedMacro.id]: updatedMacro
        }

        return game.users.get(updatedMacro.userID)?.setFlag(ConditionalMacros.ID, ConditionalMacros.FLAGS.MACROS, updated);
    }

    static deleteMacro(macroID) {
        const macro = this.allMacros[macroID];

        const deleteKey = {
            [`-=${macroID}`]: null
        }

        return game.users.get(macro.userID)?.setFlag(ConditionalMacros.ID, ConditionalMacros.FLAGS.MACROS, deleteKey);
    }

    static updateUserMacros(userId, updateData) {
        return game.users.get(userId)?.setFlag(ConditionalMacros.ID, ConditionalMacros.FLAGS.MACROS, updateData);
    }

    static addMacroComponent(macroID) {
        const macro = this.allMacros[macroID]
        let id = foundry.utils.randomID(16) 
        macro.components[id] = {
            id: id,
            name: "New Component",
            roll: "d20"
        }
        return this.updateMacro(macro)
    }

    static updateMacroComponent(macroID, component) {
        const macro = this.allMacros[macroID]
        macro.components[components.id] = component
        return this.updateMacro(macro)
    }

    static removeMacroComponent(macroID, componentID) {
        const macro = this.allMacros[macroID]

        const deleteKey = {
            [macro.id]: {
                components: {
                    [`-=${componentID}`]: null
                }
            }
        }

        return game.users.get(macro.userID)?.setFlag(ConditionalMacros.ID, ConditionalMacros.FLAGS.MACROS, deleteKey);
    }
}

class ConditionalList extends FormApplication {
    static get defaultOptions() {
        const defaults = super.defaultOptions

        const overrides = {
            height: 'auto',
            width: "auto",
            id: 'conditional-list',
            template: ConditionalMacros.TEMPLATES.LIST,
            title: "Conditional Macro List",
            userId: game.userId,
            closeOnSubmit: false,
            submitOnChange: true
        }

        const mergedOptions = foundry.utils.mergeObject(defaults, overrides)

        return mergedOptions
    }

    getData(options) {
        return {
            macros: ConditionalMacroStorage.getUserMacros(options.userId)
        }
    }

    activateListeners(html) {
        super.activateListeners(html);
    
        html.on('click', "[data-action]", this._handleButtonClick.bind(this));
    }

    async _handleButtonClick(event) {
        const clickedElement = $(event.currentTarget);
        const action = clickedElement.data().action;
        const macroId = clickedElement.parents('[data-macro-id]')?.data()?.macroId;
        
        ConditionalMacros.log(false, 'Button Clicked!', {action, macroId});

        switch(action) {
            case "create":
                await ConditionalMacroStorage.createMacro(this.options.userId, "New Macro")
                this.render()
                break
            case "delete":
                await ConditionalMacroStorage.deleteMacro(macroId)
                this.render()
                break
            case "edit":
                ConditionalMacros.conditionalMacroEditor.render(true, {macroId})
                break
            case "shortcut":
                let shortcut = await Macro.create({
                    name: ConditionalMacroStorage.allMacros[macroId].name,
                    type: CONST.MACRO_TYPES.SCRIPT,
                    command: `game.modules.get("${ConditionalMacros.ID}").api.rollMacro("${macroId}")`
                })
                game.users.get(this.options.userId).assignHotbarMacro(shortcut)
                break
            case "roll":
                ConditionalMacros.showRollDialogue(macroId)
            default:
                ConditionalMacros.log(false, "Invalid action", action)
        }
    }

    async _updateObject(event, formData) {
        const expandedData = foundry.utils.expandObject(formData)

        ConditionalMacros.log(false, expandedData)

        await ConditionalMacroStorage.updateUserMacros(this.options.userId, expandedData)

        this.render()
    }
}

class ConditionalMacroEditor extends FormApplication {
    static get defaultOptions() {
        const defaults = super.defaultOptions

        const overrides = {
            height: 'auto',
            id: 'conditional-macro-editor',
            template: ConditionalMacros.TEMPLATES.EDITOR,
            title: "Conditional Macro Editor",
            userId: game.userId,
            macroId: null,
            closeOnSubmit: false,
            submitOnChange: true
        }

        const mergedOptions = foundry.utils.mergeObject(defaults, overrides)

        return mergedOptions
    }

    getData(options) {
        return {
            macro: ConditionalMacroStorage.allMacros[options.macroId],
            damageTypes: CONFIG?.DND5E?.damageTypes
        }
    }

    activateListeners(html) {
        super.activateListeners(html);
    
        html.on('click', "[data-action]", this._handleButtonClick.bind(this));
    }

    async _handleButtonClick(event) {
        const clickedElement = $(event.currentTarget)
        const action = clickedElement.data().action
        const macroId = clickedElement.parents('[data-macro-id]')?.data()?.macroId
        const componentId = clickedElement.parents('[data-component-id]')?.data()?.componentId
        
        ConditionalMacros.log(false, 'Button Clicked!', {action, macroId, componentId})

        switch(action) {
            case "create":
                await ConditionalMacroStorage.addMacroComponent(macroId)
                this.render()
                break
            case "delete":
                await ConditionalMacroStorage.removeMacroComponent(macroId, componentId)
                this.render()
                break
            default:
                ConditionalMacros.log(false, "Invalid action", action)
        }
    }

    async _updateObject(event, formData) {
        const expandedData = foundry.utils.expandObject(formData)

        for (let i in expandedData) {
            expandedData[i] = foundry.utils.mergeObject(ConditionalMacroStorage.allMacros[i], expandedData[i], {recursive: true, insertKeys: true, insertValues: true})
        }

        ConditionalMacros.log(false, expandedData)

        await ConditionalMacroStorage.updateUserMacros(this.options.userId, expandedData)

        this.render()
        if (ConditionalMacros.conditionalList.rendered) {
            ConditionalMacros.conditionalList.render()
        }
    }
}