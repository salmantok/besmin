#!/usr/bin/env node
import path from 'path'
import chokidar from 'chokidar'
import fs from 'fs-extra'
import presetEnv from '@babel/preset-env'
import transformModulesAmd from '@babel/plugin-transform-modules-amd'
import transformModulesCommonjs from '@babel/plugin-transform-modules-commonjs'
import transformModulesSystemjs from '@babel/plugin-transform-modules-systemjs'
import transformModulesUmd from '@babel/plugin-transform-modules-umd'
import { minify } from 'terser'
import { transformSync } from '@babel/core'

async function processFile(
  inputPath,
  outputPath,
  moduleType,
  isInputPath = false
) {
  try {
    const code = await fs.readFile(inputPath, 'utf-8')
    const babelOptions = {
      esm: {
        presets: [[presetEnv, { modules: false, targets: '> 0.5%, not dead' }]],
      },
      cjs: {
        presets: [[presetEnv, { modules: false, targets: '> 0.5%, not dead' }]],
        plugins: [[transformModulesCommonjs]],
      },
      sysjs: {
        presets: [[presetEnv, { modules: false, targets: '> 0.5%, not dead' }]],
        plugins: [[transformModulesSystemjs]],
      },
      amd: {
        presets: [[presetEnv, { modules: false, targets: '> 0.5%, not dead' }]],
        plugins: [[transformModulesAmd]],
      },
      umd: {
        presets: [[presetEnv, { modules: false, targets: '> 0.5%, not dead' }]],
        plugins: [[transformModulesUmd]],
      },
    }[moduleType]
    const transformed = transformSync(code, {
      ...babelOptions,
      sourceMaps: true,
    })
    const minified = await minify(transformed.code, { sourceMap: true })

    !isInputPath
      ? (await fs.outputFile(outputPath, minified.code, 'utf-8'),
        minified.map &&
          (await fs.outputFile(`${outputPath}.map`, minified.map)),
        console.log(`✔ Output Ok: ${outputPath}`))
      : null
  } catch (err) {}
}

async function syntaxWithBabel(inputPath) {
  try {
    const code = await fs.readFile(inputPath, 'utf-8')
    const transformed = transformSync(code, {
      presets: [[presetEnv, { targets: '> 0.5%' }]],
    })
    transformed?.code ? console.log(`✔ Input OK: ${inputPath}`) : null
  } catch (err) {
    console.error(`❌ Input error: ${inputPath}`)
    console.error(err.message)
  }
}

async function validateFiles(inputDir) {
  const files = await fs.readdir(inputDir)
  for (const file of files) {
    const inputPath = path.join(inputDir, file)
    const stats = await fs.stat(inputPath)

    stats.isDirectory()
      ? await validateFiles(inputPath)
      : stats.isFile() && path.extname(file) === '.js'
        ? await syntaxWithBabel(inputPath)
        : null
  }
}

async function buildFiles(inputDir, outputDir, moduleType) {
  const files = await fs.readdir(inputDir)
  for (const file of files) {
    const inputPath = path.join(inputDir, file)
    const outputPath = path.join(outputDir, file)
    const stats = await fs.stat(inputPath)

    stats.isDirectory()
      ? await buildFiles(inputPath, outputPath, moduleType)
      : stats.isFile() && path.extname(file) === '.js'
        ? await processFile(inputPath, outputPath, moduleType, false)
        : null
  }
}

async function watchAndBuild(inputDir, outputDir, moduleTypes) {
  const watcher = chokidar.watch(inputDir, { ignored: /(^|[\/\\])\../ })
  console.log(`👀 Watching: ${inputDir}`)

  watcher.on('change', async (filePath) => {
    console.log(`🔄 Changed: ${filePath}`)
    const relativePath = path.relative(inputDir, filePath)

    for (const moduleType of moduleTypes) {
      const moduleOutputDir = path.join(outputDir, moduleType)
      const outputPath = path.join(moduleOutputDir, relativePath)

      await fs.ensureDir(path.dirname(outputPath))
      await processFile(filePath, outputPath, moduleType)
    }
  })
}

async function main() {
  const args = process.argv.slice(2)
  const inputDir = args[0],
    outputDir = args[1],
    isWatchMode = args.includes('--watch')
  const moduleTypes = args.filter((arg) =>
    ['cjs', 'sysjs', 'amd', 'umd', 'esm'].includes(arg)
  )
  const isModuleTypes =
    '❌ Usage: <inputDir> <outputDir> [cjs|umd|amd|sysjs] (or default [esm]) [--watch]'

  moduleTypes.includes('esm') && moduleTypes.length === 1
    ? (console.error(isModuleTypes), process.exit(1))
    : null

  const resolvedModuleTypes = moduleTypes.length > 0 ? moduleTypes : ['esm']
  !inputDir || !outputDir
    ? (console.error(isModuleTypes), process.exit(1))
    : null

  console.log('🔄 Starting...')
  for (const moduleType of resolvedModuleTypes) {
    console.log(`🔍 Validating: ${moduleType}`)
    await validateFiles(inputDir)
    const moduleOutputDir = path.join(outputDir, moduleType)
    await fs.ensureDir(moduleOutputDir)
    await buildFiles(inputDir, moduleOutputDir, moduleType)
  }

  isWatchMode && (await watchAndBuild(inputDir, outputDir, resolvedModuleTypes))
}
main()
