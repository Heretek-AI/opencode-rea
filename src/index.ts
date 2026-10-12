import { Plugin } from "@opencode/plugin"
import { parseOptions } from "./options.js"
import { registerSkills } from "./skills.js"

export default Plugin.define({
  id: "rea",
  setup: async (ctx) => {
    const options = parseOptions(ctx.options)
    await registerSkills(ctx as any, options)
  },
})
