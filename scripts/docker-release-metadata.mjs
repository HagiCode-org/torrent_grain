import fs from 'node:fs';
import path from 'node:path';

const PLATFORM_MATRIX = {
  all: {
    dockerPlatforms: 'linux/amd64,linux/arm64',
    label: 'linux/amd64, linux/arm64',
  },
  'linux-amd64': {
    dockerPlatforms: 'linux/amd64',
    label: 'linux/amd64',
  },
  'linux-arm64': {
    dockerPlatforms: 'linux/arm64',
    label: 'linux/arm64',
  },
};

function firstNonEmpty(...values) {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0)?.trim() ?? '';
}

function loadPackageVersion() {
  const packageJsonPath = path.resolve(process.cwd(), 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  return typeof packageJson.version === 'string' ? packageJson.version.trim() : '';
}

function resolveVersion() {
  const explicitVersion = firstNonEmpty(process.env.INPUT_VERSION, process.env.EVENT_VERSION);
  if (explicitVersion) {
    return explicitVersion.replace(/^v/, '');
  }

  const gitRef = process.env.GITHUB_REF ?? '';
  if (gitRef.startsWith('refs/tags/')) {
    return gitRef.slice('refs/tags/'.length).replace(/^v/, '');
  }

  const packageVersion = loadPackageVersion();
  if (!packageVersion) {
    throw new Error('Unable to resolve image version from inputs, tag, or package.json.');
  }
  return packageVersion.replace(/^v/, '');
}

function parseVersion(version) {
  const match = version.match(
    /^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?<prerelease>-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
  );

  if (!match?.groups) {
    throw new Error(`Unsupported version "${version}". Expected semver such as 1.2.3 or 1.2.3-rc.1.`);
  }

  return {
    major: match.groups.major,
    minor: match.groups.minor,
    patch: match.groups.patch,
    prerelease: match.groups.prerelease ?? '',
    stable: !match.groups.prerelease,
  };
}

function resolvePlatform() {
  const selector = firstNonEmpty(process.env.INPUT_PLATFORM, process.env.EVENT_PLATFORM, 'all');
  const resolved = PLATFORM_MATRIX[selector];
  if (!resolved) {
    throw new Error(`Unsupported platform selector "${selector}". Use all, linux-amd64, or linux-arm64.`);
  }
  return {
    selector,
    ...resolved,
  };
}

function resolveImageRepository() {
  const imageName = firstNonEmpty(process.env.IMAGE_NAME, 'torrent-grain');
  const registryKind = firstNonEmpty(process.env.REGISTRY_KIND);

  if (registryKind === 'dockerhub') {
    const namespace = firstNonEmpty(process.env.DOCKERHUB_NAMESPACE, process.env.DOCKERHUB_USERNAME, 'newbe36524');
    return {
      registryLabel: 'DockerHub',
      imageRepository: `${namespace}/${imageName}`,
      summaryImageRepository: `docker.io/${namespace}/${imageName}`,
    };
  }

  if (registryKind === 'aliyun') {
    const registry = firstNonEmpty(process.env.ALIYUN_ACR_REGISTRY);
    const namespace = firstNonEmpty(process.env.ALIYUN_ACR_NAMESPACE);

    if (!registry || !namespace) {
      throw new Error('Aliyun ACR release requires ALIYUN_ACR_REGISTRY and ALIYUN_ACR_NAMESPACE.');
    }

    return {
      registryLabel: 'Aliyun ACR',
      imageRepository: `${registry}/${namespace}/${imageName}`,
      summaryImageRepository: `${registry}/${namespace}/${imageName}`,
    };
  }

  throw new Error(`Unsupported registry kind "${registryKind}".`);
}

function emitOutput(name, value) {
  if (value.includes('\n')) {
    process.stdout.write(`${name}<<EOF\n${value}\nEOF\n`);
    return;
  }
  process.stdout.write(`${name}=${value}\n`);
}

const version = resolveVersion();
const parsedVersion = parseVersion(version);
const platform = resolvePlatform();
const image = resolveImageRepository();
const tags = parsedVersion.stable
  ? [version, `${parsedVersion.major}.${parsedVersion.minor}`, parsedVersion.major, 'latest']
  : [version];
const dockerTags = tags.map((tag) => `${image.imageRepository}:${tag}`).join('\n');
const summaryTagsMarkdown = tags.map((tag) => `- \`${image.summaryImageRepository}:${tag}\``).join('\n');

emitOutput('version', version);
emitOutput('is_stable', parsedVersion.stable ? 'true' : 'false');
emitOutput('platform_selector', platform.selector);
emitOutput('platform_label', platform.label);
emitOutput('docker_platforms', platform.dockerPlatforms);
emitOutput('registry_label', image.registryLabel);
emitOutput('image_repository', image.imageRepository);
emitOutput('summary_image_repository', image.summaryImageRepository);
emitOutput('docker_tags', dockerTags);
emitOutput('summary_tags_markdown', summaryTagsMarkdown);
