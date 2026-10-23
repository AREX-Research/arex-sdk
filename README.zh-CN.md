# AREX SDK

中文 | [English](./README.md)

AREX 公共 API 的官方 SDK：网页 Search、页面 Contents、异步 Research。

## 安装

### TypeScript

需要 Node >= 20 或 Bun。[完整文档](./ts/README.md)。

从 npm 安装：

```sh
npm install @arex-research/ts-sdk
```

或从 [GitHub Releases](https://github.com/AREX-Research/arex-sdk/releases/latest) 下载 `.tgz` 安装：

```sh
npm install ./arex-research-ts-sdk-*.tgz
```

### Python

需要 Python >= 3.10。[完整文档](./python/README.md)。

从 PyPI 安装：

```sh
pip install arex-python-sdk
```

或从 [GitHub Releases](https://github.com/AREX-Research/arex-sdk/releases/latest) 下载 `.whl` 安装：

```sh
pip install ./arex_python_sdk-*.whl
```

## 使用

两个客户端都从 `AREX_API_KEY` 读取密钥，暴露相同的调用：`search`、`contents`、`research.create/get/cancel/delete/wait/run`。Python 同时提供同步 `Arex` 与异步 `AsyncArex`。

```ts
import { Arex } from "@arex-research/ts-sdk";

const arex = new Arex();
const { results } = await arex.search("AI Agent 的最新进展", { limit: 5 });
const run = await arex.research.run("比较当前 AI Agent 评测方法");
```

```py
from arex import Arex

with Arex() as arex:
    results = arex.search("AI Agent 的最新进展", limit=5)
    run = arex.research.run("比较当前 AI Agent 评测方法")
```

API Key 是机密，只在服务端代码中使用 SDK。

维护者：[DESIGN.md](./DESIGN.md) 介绍模块结构与约定，[CONTRACT.md](./CONTRACT.md) 记录 SDK 策略，[CONTRIBUTING.md](./CONTRIBUTING.md) 介绍开发环境、检查与契约更新，[RELEASING.md](./RELEASING.md) 介绍发布流程，[SECURITY.md](./SECURITY.md) 说明如何私下报告安全漏洞。[fixtures/](./fixtures) 是两套测试共用的响应。

[Apache License 2.0](./LICENSE)。
