<h1 align="center">Modbus Slave Studio</h1>

<p align="center">
  <strong>简单好用的 Modbus TCP / RTU 从机模拟器</strong><br/>
  用 React + Rust（Tauri 2）构建 · 配置寄存器、跨寄存器变量、查看完整报文
</p>

<p align="center">
  <a href="https://tauri.app"><img alt="Tauri" src="https://img.shields.io/badge/Tauri-2.12-24C8DB?logo=tauri&logoColor=white" /></a>
  <a href="https://react.dev"><img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" /></a>
  <a href="https://www.rust-lang.org"><img alt="Rust" src="https://img.shields.io/badge/Rust-1.90%2B-000000?logo=rust&logoColor=white" /></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg" /></a>
  <img alt="Platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey" />
</p>

<p align="center">
  <a href="#功能">功能</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#变量与字节序">变量</a> ·
  <a href="#请求与响应日志">日志</a> ·
  <a href="#rtu-串口排错">RTU 排错</a> ·
  <a href="#从源码构建">构建</a>
</p>

<p align="center">
  <img src="docs/screenshot.png" alt="Modbus Slave Studio 变量视图" width="92%" />
</p>

<p align="center">
  <sub>变量视图：合并值、字节序、可直接编辑的数值 / HEX 列</sub>
</p>

**Modbus Slave Studio** 是一个面向开发、集成和现场调试的 **Modbus TCP / RTU 从机模拟器**。不需要 PLC，直接在桌面上配置四个数据区，模拟主站读取或写入，并用完整报文日志排查 CRC、从站地址、字节序和接线问题。

所有数据都保存在本地，不依赖云服务，也不会上传任何内容。

---

## 功能

### 通信

- **Modbus TCP**：监听指定网卡/端口，支持多个主站连接。
- **Modbus RTU**：串口 / RS485，支持波特率、校验位、停止位、从站地址。
- **四个数据区**：线圈（0x）、离散输入（1x）、保持寄存器（4x）、输入寄存器（3x），每区 100 点。
- 支持功能码 **01 / 02 / 03 / 04 / 05 / 06 / 0F / 10**，带标准异常码。

### 编辑与变量

- **寄存器视图**：一个寄存器一行，显示 PLC 地址、协议偏移、数值、HEX、有符号和无符号解释。
- **变量视图**：把 1–100 个连续寄存器定义成带别名的变量，适合处理浮点数、累计值、参数块。
- **1 / 2 / 4 个寄存器可直接合并为数值**：
  - 1 个 → `U16` / `I16`
  - 2 个 → `U32` / `I32` / `F32`（4 字节浮点）
  - 4 个 → `F64`（8 字节浮点）
- **任意数量都可以选择「仅分组」**，只给一段寄存器取别名，不合并数值。
- 32 / 64 位字节序可选：`ABCD`、`CDAB`、`BADC`、`DCBA`、`ABCDEFGH`、`GHEFCDAB`、`BADCFEHG`、`HGFEDCBA`。
- 数值框支持十进制、有符号数、浮点数和 `0x` 十六进制；浮点数甚至可以输入 IEEE 原始位型。

### 诊断与备份

- **完整请求 / 响应报文日志**：每条记录展示 `→ 请求` 和 `← 响应` 的完整 HEX。
- **成功绿色 / 失败红色**，并给出原因：CRC 校验错误、从站地址不匹配、帧长度错误、非法地址、非法功能码、TCP 帧格式错误、串口异常等。
- 未被应答的无效帧也会记录，响应行显示「无响应」。
- **配置备份**：把变量定义和全部寄存器/线圈值导出为 JSON，换电脑或重装后一键恢复。
- 自动保存、本机 IP 提示、复制连接地址、随机填充、全部清零、寄存器搜索式浏览。

---

## 界面

### 寄存器视图

逐寄存器显示，HEX 严格按单个寄存器展示；变量以标题行合并显示。

![寄存器视图](docs/register-view.png)

### 请求与响应日志

所有收到的帧都会进入日志，请求和响应都有完整十六进制报文。

![请求与响应日志](docs/log-view.png)

---

## 快速开始

### 下载

前往本仓库的 **Releases** 页面下载 **v1.0.0**：

- **macOS 通用版**（Apple Silicon + Intel）：`.zip`，解压后得到 `.app`
- **Windows x64**：`.exe` 安装包

> macOS 构建未使用开发者证书签名。首次打开如提示无法验证，请右键应用 → **打开**。
>
> Windows 安装时如出现 SmartScreen 提示，可选择「更多信息」→「仍要运行」。

### 30 秒上手

1. 启动应用，在左侧选择 **TCP 网络** 或 **RTU 串口**。
2. 填写连接参数，点击右上角 **启动服务**。
3. 用 Modbus 主站连接：
   - TCP：连接界面显示的 `IP:端口`，从站地址保持一致。
   - RTU：选择对应串口，波特率、校验位、停止位、从站地址保持一致。
4. 在右侧直接修改寄存器或变量，主站即可读到新值；主站的写操作也会显示在日志中。

TCP 默认端口为 `5020`。macOS 上绑定 `502` 需要管理员权限，建议使用 `5020` / `1502` 等端口。

---

## 变量与字节序

很多设备会把一个 32/64 位值拆成多个寄存器。点击数据区右上角的 **新建变量**，输入别名、起始地址和寄存器数量即可。

| 寄存器数量 | 可选格式 | 字节数 |
| --- | --- | --- |
| 1 | `U16` / `I16` | 2 字节 |
| 2 | `U32` / `I32` / `F32` | 4 字节 |
| 4 | `F64` | 8 字节 |
| 其它数量或选择「仅分组」 | 分组别名 | — |

![新建变量或分组](docs/variable-dialog.png)

- 变量只是对现有寄存器的**解释和快捷编辑方式**，不会新增 Modbus 地址。
- 修改变量值会写入对应寄存器；直接修改原始寄存器，变量值也会同步更新。
- 变量标题可以折叠、编辑类型或删除，定义会自动保存。

### 字节序

| 位宽 | 可选值 |
| --- | --- |
| 32 位 | `ABCD`（大端，常用）、`CDAB`（字交换）、`BADC`（字节交换）、`DCBA`（小端） |
| 64 位 | `ABCDEFGH`（大端，常用）、`GHEFCDAB`（字交换）、`BADCFEHG`（字节交换）、`HGFEDCBA`（小端） |

如果读出来的浮点数明显不对，优先尝试 `CDAB` 或 `HGFEDCBA`。

### 十六进制输入

- 地址支持：`40001`（PLC 编号）、`13`（协议偏移）、`000D` / `0x000D`（十六进制偏移）。
- 变量值支持：`0xFFFF`、`0xFFFFFFFF`，以及：
  - `F32` 原始位型：`0x41CCCCCD`（25.6）
  - `F64` 原始位型：`0x403999999999999A`（25.6）
- 变量视图的 HEX 是**合并值的逻辑位型**；寄存器视图的 HEX 是**按字节序拆分后的单个寄存器值**。

### 双视图

用数据区右上角的 **寄存器 / 变量** 切换：

- **寄存器视图**：逐寄存器编辑和查看 HEX。
- **变量视图**：一个变量/分组一行，适合快速修改整体值。

---

## 请求与响应日志

日志会记录所有收到的帧，不只成功的请求：

- `→ 请求`：主站发来的完整帧 HEX。TCP 包含 MBAP 头，RTU 包含地址和 CRC。
- `← 响应`：从机返回的完整帧 HEX；没有响应时显示「无响应」。
- 成功显示绿色，失败显示红色，并在右侧给出原因：
  - `CRC 校验错误`
  - `从站地址不匹配（收到 9，本机 23）`
  - `帧长度不足（2 字节）`
  - `非法地址` / `非法功能码` / `非法数据值`
  - `TCP 帧格式错误`
  - `串口读取失败 / 写入失败`
- 左侧「接收帧数」统计所有收到的请求帧。

---

## 支持的协议

| 功能码 | 功能 | 说明 |
| --- | --- | --- |
| 01 (0x01) | 读线圈 | 最多 2000 点 |
| 02 (0x02) | 读离散输入 | 最多 2000 点 |
| 03 (0x03) | 读保持寄存器 | 最多 125 个 |
| 04 (0x04) | 读输入寄存器 | 最多 125 个 |
| 05 (0x05) | 写单个线圈 | 仅支持 `0x0000` / `0xFF00` |
| 06 (0x06) | 写单个寄存器 | |
| 15 (0x0F) | 写多个线圈 | 最多 1968 点 |
| 16 (0x10) | 写多个寄存器 | 最多 123 个 |

不支持的功能码返回异常码 `01`；地址越界返回 `02`；参数不合法返回 `03`。

### 地址映射

界面按 PLC 习惯显示地址，协议偏移从 0 开始：

| 数据区 | PLC 地址 | 协议偏移 |
| --- | --- | --- |
| 保持寄存器 | 40001 – 40100 | 0 – 99 |
| 输入寄存器 | 30001 – 30100 | 0 – 99 |
| 线圈 | 00001 – 00100 | 0 – 99 |
| 离散输入 | 10001 – 10100 | 0 – 99 |

---

## 配置备份

左侧「快捷操作」卡片底部有 **导出配置 / 导入配置**：

- 导出 JSON，包含变量/分组定义和全部寄存器、线圈值。
- 不包含 TCP/串口连接参数，换机器后需要重新配置连接。
- 导入前会确认；确认后覆盖当前变量和数值，连接参数不变。
- 配置文件带 `format` / `version` 校验，格式不匹配会拒绝导入。

---

## RTU 串口排错

### 先看三个状态

1. 右上角状态是否为 **RTU 运行中**。
2. 左侧「串口状态」是否为 **已打开**。
3. 日志里是否出现 `→ 请求`。

如果串口状态还是「未打开」，说明服务没启动或串口打开失败，先点击 **启动服务**。

### 检查清单

- **串口选择**：CH340/CH341 在 macOS 通常显示为 `/dev/cu.wchusbserial*`，Windows 为 `COMx`，Linux 为 `/dev/ttyUSB*`。重新插拔后端口号可能变化，点击「刷新」重新选择。
- **参数一致**：波特率、数据位、校验位、停止位、从站地址必须和主站完全一致。常见组合是 `9600 8N1`（请把校验位设为「无校验」）。
- **接线**：RS485 的 A/B 不要接反，建议共地；长线或高速率时考虑终端电阻。
- **转换器类型**：USB-TTL 只有 TX/RX/GND，不能直接接 RS485 A/B，需要 TTL-RS485 转换模块。
- **驱动与占用**：确认已安装 CH34x 驱动，并且没有串口助手、Modbus Poll 等程序占用同一串口。
- **从站地址**：主站使用其他地址时，从机会记录「从站地址不匹配」但不会应答。

### 从日志判断问题

| 现象 | 可能原因 |
| --- | --- |
| 完全没有任何日志 | 服务未启动、主站未发送、A/B 接线错误、转换器方向问题 |
| 有请求，响应「无响应」，原因为 `CRC 校验错误` | 波特率/校验位/停止位不一致 |
| 有请求，原因为 `从站地址不匹配` | 主站从站地址与设置不同 |
| 有请求，响应为 `01 83 02 ...` | 主站访问了不支持的地址 |
| 请求和响应都有完整报文 | RTU 收发正常 |

---

## 从源码构建

### 环境要求

- Node.js 20+（推荐 22 LTS）
- pnpm 9+
- Rust 1.90+
- Tauri 平台依赖：参见 [Tauri prerequisites](https://tauri.app/start/prerequisites/)

### 开发

```bash
git clone https://github.com/davyxiaoxiao/MyModbusClient.git
cd MyModbusClient
pnpm install
pnpm tauri dev
```

### 打包

```bash
pnpm tauri build
```

产物位于 `src-tauri/target/release/bundle/`。

### 测试

```bash
# 前端类型检查 + 构建
pnpm build

# Rust 协议 / TCP / RTU / 日志 / 文件读写测试
cd src-tauri && cargo test
```

开发构建会生成 `node_modules`、`dist` 和 `src-tauri/target`，这些目录已在 `.gitignore` 中忽略。发布用的 `.app` / 安装包在 `release/` 目录，不需要这些缓存即可运行。

---

## 项目结构

```
src/                      React 前端
  components/             连接面板、数据表格、变量弹窗、请求日志
  api.ts                  Tauri 命令封装
  variables.ts            U16/I16/U32/I32/F32/F64、字节序、编解码
  backup.ts               配置备份格式与校验
  storage.ts              本地配置、数值和变量定义持久化

src-tauri/src/
  modbus.rs               Modbus PDU、功能码、异常码、寄存器表
  server.rs               Modbus TCP 从站与日志
  rtu.rs                  Modbus RTU 串口、CRC16、帧间隔
  lib.rs                  Tauri 命令、状态与窗口入口
```

---

## 已知限制

- 一次只运行一种传输方式（TCP 或 RTU），切换前需停止服务。
- 四个数据区固定为每区 100 点。
- 变量合并格式目前包含 U16 / I16 / U32 / I32 / F32 / F64，暂不支持 64 位整数、字符串或 Modbus ASCII。
- RTU 界面固定使用 8 个数据位。
- 模拟器没有 TLS、认证或访问控制，请只在可信的本机/局域网使用。
- macOS / Windows 发布包都未签名；macOS 未公证，Windows 可能触发 SmartScreen 提示。

---

## 贡献

欢迎提交 Issue 和 Pull Request。提交前请尽量说明：

- 操作系统、应用版本
- TCP 还是 RTU，串口型号（如 CH340/CH341/FT232）
- 主站参数与从站参数
- 日志中的请求/响应完整 HEX 或截图

---

## License

[MIT](LICENSE) © 2026 MyModbusClient contributors

如果这个项目对你有帮助，欢迎 Star ⭐

<details>
<summary>English overview</summary>

**Modbus Slave Studio** is a simple, cross-platform Modbus TCP / RTU slave simulator built with React and Rust (Tauri 2). It provides 100 coils, 100 discrete inputs, 100 holding registers and 100 input registers, supports function codes 01–06 / 15 / 16, and lets you define named variables spanning 1–4 registers (U16/I16/U32/I32/F32/F64) with configurable byte order.

It includes a full request/response hexadecimal log with success/failure colours and diagnostic reasons, JSON configuration export/import, automatic local persistence, and a clean dual-view editor (per-register or merged variables).

Download the latest build from the Releases page, or build from source with `pnpm install && pnpm tauri dev`.

</details>
