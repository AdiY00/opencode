import path from "path"
import { pathToFileURL } from "url"
import { Effect, Schema } from "effect"
import * as Stream from "effect/Stream"
import { Ripgrep } from "../file/ripgrep"
import { Skill } from "../skill"
import * as Tool from "./tool"
import DESCRIPTION from "./skill.txt"

export const Parameters = Schema.Struct({
  name: Schema.String.annotate({ description: "The name of the skill from available_skills" }),
})

export const SkillTool = Tool.define(
  "skill",
  Effect.gen(function* () {
    const skill = yield* Skill.Service
    const rg = yield* Ripgrep.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const info = yield* skill.get(params.name)
          if (!info) {
            const all = yield* skill.all()
            const available = all.map((item) => item.name).join(", ")
            throw new Error(`Skill "${params.name}" not found. Available skills: ${available || "none"}`)
          }

          if (isLoaded(ctx.messages, params.name, info.content)) {
            return {
              title: `Loaded skill: ${info.name}`,
              output: [
                `<skill_content name="${info.name}" already_loaded="true">`,
                `Skill "${info.name}" is already loaded in this conversation. Use the existing skill instructions.`,
                "</skill_content>",
              ].join("\n"),
              metadata: {
                name: info.name,
                dir: path.dirname(info.location),
                alreadyLoaded: true,
              },
            }
          }

          yield* ctx.ask({
            permission: "skill",
            patterns: [params.name],
            always: [params.name],
            metadata: {},
          })

          const dir = path.dirname(info.location)
          const base = pathToFileURL(dir).href
          const limit = 10
          const files = yield* rg.files({ cwd: dir, follow: false, hidden: true, signal: ctx.abort }).pipe(
            Stream.filter((file) => !file.includes("SKILL.md")),
            Stream.map((file) => path.resolve(dir, file)),
            Stream.take(limit),
            Stream.runCollect,
            Effect.map((chunk) => [...chunk].map((file) => `<file>${file}</file>`).join("\n")),
          )

          return {
            title: `Loaded skill: ${info.name}`,
            output: [
              `<skill_content name="${info.name}">`,
              `# Skill: ${info.name}`,
              "",
              info.content.trim(),
              "",
              `Base directory for this skill: ${base}`,
              "Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.",
              "Note: file list is sampled.",
              "",
              "<skill_files>",
              files,
              "</skill_files>",
              "</skill_content>",
            ].join("\n"),
            metadata: {
              name: info.name,
              dir,
              alreadyLoaded: false,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

function isLoaded(messages: Tool.Context["messages"], name: string, content: string) {
  const text = content.trim()
  return messages.some((message) =>
    message.parts.some((part) => {
      if (part.type === "text") return text !== "" && part.text.includes(text)
      if (part.type !== "tool") return false
      if (part.tool !== SkillTool.id) return false
      if (part.state.status !== "completed") return false
      return part.state.metadata.name === name && part.state.metadata.alreadyLoaded !== true
    }),
  )
}
