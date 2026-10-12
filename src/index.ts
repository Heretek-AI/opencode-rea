import { Plugin } from "@opencode/plugin"
import { registerAgents } from "./agents.js"
import { registerCommands } from "./commands.js"
import { parseOptions } from "./options.js"
import { registerReadiness } from "./readiness.js"
import { registerSkills } from "./skills.js"

export default Plugin.define({
  id: "rea",
  setup: async (ctx) => {
    const options = parseOptions(ctx.options)
    await registerSkills(ctx as any, options)
    await registerAgents(ctx as any, options)
    await registerReadiness(ctx as any, options)
    await registerCommands(ctx as any, options)
  },
})
