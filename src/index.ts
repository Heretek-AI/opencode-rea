import { Plugin } from "@opencode/plugin"
import { parseOptions } from "./options.js"

export default Plugin.define({
  id: "rea",
  setup: async (ctx) => {
    parseOptions(ctx.options)
  },
})
