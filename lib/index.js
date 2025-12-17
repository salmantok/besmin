#!/usr/bin/env node
import path from 'path';
import chokidar from 'chokidar';
import fs from 'nodefs-lite';
import { minify } from 'terser';
import presetEnv from '@babel/preset-env';
import presetTypescript from '@babel/preset-typescript';
import transformModulesAmd from '@babel/plugin-transform-modules-amd';
import transformModulesCommonjs from '@babel/plugin-transform-modules-commonjs';
import transformModulesSystemjs from '@babel/plugin-transform-modules-systemjs';
import transformModulesUmd from '@babel/plugin-transform-modules-umd';
import { transformSync } from '@babel/core';

async function processFile(
    inputPath,
    outputPath,
    moduleType,
    isInputPath = false
) {
    try {
        const code = await fs.readFile(inputPath, 'utf-8');
        const babelOptions = {
            esm: {
                presets: [
                    [
                        presetEnv,
                        { modules: false, targets: '> 0.5%, not dead' },
                    ],
                    presetTypescript,
                ],
            },
            cjs: {
                presets: [
                    [
                        presetEnv,
                        { modules: false, targets: '> 0.5%, not dead' },
                    ],
                    presetTypescript,
                ],
                plugins: [[transformModulesCommonjs]],
            },
            sysjs: {
                presets: [
                    [
                        presetEnv,
                        { modules: false, targets: '> 0.5%, not dead' },
                    ],
                    presetTypescript,
                ],
                plugins: [[transformModulesSystemjs]],
            },
            amd: {
                presets: [
                    [
                        presetEnv,
                        { modules: false, targets: '> 0.5%, not dead' },
                    ],
                    presetTypescript,
                ],
                plugins: [[transformModulesAmd]],
            },
            umd: {
                presets: [
                    [
                        presetEnv,
                        { modules: false, targets: '> 0.5%, not dead' },
                    ],
                    presetTypescript,
                ],
                plugins: [[transformModulesUmd]],
            },
        }[moduleType];
        const transformed = transformSync(code, {
            ...babelOptions,
            filename: inputPath,
            sourceMaps: true,
        });
        const minified = await minify(transformed.code, { sourceMap: true });

        !isInputPath
            ? (await fs.outputFile(outputPath, minified.code, 'utf-8'),
              minified.map &&
                  (await fs.outputFile(`${outputPath}.map`, minified.map)),
              console.log(`✔ Output Ok: ${outputPath}`))
            : null;
    } catch (err) {}
}

async function syntaxWithBabel(inputPath) {
    try {
        const code = await fs.readFile(inputPath, 'utf-8');
        const transformed = transformSync(code, {
            presets: [[presetEnv, { targets: '> 0.5%' }], presetTypescript],
            filename: inputPath,
        });
        transformed?.code ? console.log(`✔ Input OK: ${inputPath}`) : null;
    } catch (err) {
        console.error(`❌ Input error: ${inputPath}`);
        console.error(err.message);
    }
}

async function validateFiles(inputDir) {
    const files = await fs.readdir(inputDir);
    for (const file of files) {
        const inputPath = path.join(inputDir, file);
        const stats = await fs.stat(inputPath);

        if (stats.isDirectory()) {
            await validateFiles(inputPath);
        } else if (
            stats.isFile() &&
            ['.js', '.ts'].includes(path.extname(file))
        ) {
            await syntaxWithBabel(inputPath);
        }
    }
}

async function buildFiles(inputDir, outputDir, moduleType) {
    const files = await fs.readdir(inputDir);
    for (const file of files) {
        const inputPath = path.join(inputDir, file);
        const outputPath = path.join(outputDir, file.replace(/\.ts$/, '.js'));
        const stats = await fs.stat(inputPath);

        if (stats.isDirectory()) {
            await buildFiles(inputPath, outputPath, moduleType);
        } else if (
            stats.isFile() &&
            ['.js', '.ts'].includes(path.extname(file))
        ) {
            await processFile(inputPath, outputPath, moduleType, false);
        }
    }
}

async function watchAndBuild(inputDir, outputDir, moduleTypes) {
    const watcher = chokidar.watch(inputDir, {
        ignored: /(^|[\/\\])\../,
        persistent: true,
    });
    console.log(`👀 Watching: ${inputDir}`);

    watcher.on('change', async (filePath) => {
        if (!['.js', '.ts'].includes(path.extname(filePath))) return;

        console.log(`🔄 Changed: ${filePath}`);
        const relativePath = path.relative(inputDir, filePath);

        for (const moduleType of moduleTypes) {
            const moduleOutputDir = path.join(outputDir, moduleType);
            const outputPath = path.join(
                moduleOutputDir,
                relativePath.replace(/\.ts$/, '.js')
            );

            await fs.ensureDir(path.dirname(outputPath));
            await processFile(filePath, outputPath, moduleType);
        }
    });
}

async function main() {
    const args = process.argv.slice(2);
    const inputDir = args[0],
        outputDir = args[1],
        isWatchMode = args.includes('--watch'),
        isFixMode = args.includes('--fix');
    const moduleTypes = args.filter((arg) =>
        ['cjs', 'sysjs', 'amd', 'umd', 'esm'].includes(arg)
    );
    const isModuleTypes =
        '❌ Usage: <inputDir> <outputDir> [cjs|umd|amd|sysjs] (or default [esm]) [--watch] [--fix]';

    if (!inputDir) {
        console.error(isModuleTypes);
        process.exit(1);
    }

    console.log('🔄 Starting...');

    if (isFixMode) {
        await validateFiles(inputDir);

        if (!isWatchMode) {
            process.exit(0);
        }
    }

    if (!outputDir) {
        console.error(isModuleTypes);
        process.exit(1);
    }

    const resolvedModuleTypes = moduleTypes.length > 0 ? moduleTypes : ['esm'];

    if (!isFixMode) {
        for (const moduleType of resolvedModuleTypes) {
            console.log(`🔍 Validating: ${moduleType}`);
            await validateFiles(inputDir);
            const moduleOutputDir = path.join(outputDir, moduleType);
            await fs.ensureDir(moduleOutputDir);
            await buildFiles(inputDir, moduleOutputDir, moduleType);
        }
    }

    if (isWatchMode) {
        console.log(`👀 Watching for changes in ${inputDir}...`);
        chokidar
            .watch(inputDir, { ignored: /(^|[\/\\])\../, persistent: true })
            .on('change', async (filePath) => {
                if (!['.js', '.ts'].includes(path.extname(filePath))) return;

                console.log(`🔄 Changed: ${filePath}`);
                if (isFixMode) {
                    await syntaxWithBabel(filePath);
                } else {
                    for (const moduleType of resolvedModuleTypes) {
                        const moduleOutputDir = path.join(
                            outputDir,
                            moduleType
                        );
                        const outputPath = path.join(
                            moduleOutputDir,
                            path
                                .relative(inputDir, filePath)
                                .replace(/\.ts$/, '.js')
                        );

                        await fs.ensureDir(path.dirname(outputPath));
                        await processFile(filePath, outputPath, moduleType);
                    }
                }
            });
    }
}
main();
