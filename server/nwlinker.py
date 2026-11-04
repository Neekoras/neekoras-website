#!/usr/bin/env python3
"""Links a NumWorks .nwa app into a flat image for one calculator's external apps area.

  nwlinker.py APP.nwa FLASH_START FLASH_END RAM_START RAM_END TRAMPOLINE OUT.bin

The addresses come from the calculator's userland header, read over USB by the installer page.
The runtime below (startup code and system call stubs) is written for this site.
"""
import os, subprocess, sys, tempfile

SVC = {  # Epsilon system call numbers (API level 0)
    "eadk_backlight_brightness": 1, "eadk_backlight_set_brightness": 2,
    "eadk_display_pull_rect": 18, "eadk_display_push_rect": 19,
    "eadk_display_push_rect_uniform": 20, "eadk_display_wait_for_vblank": 21,
    "eadk_event_get": 23, "eadk_keyboard_pop_state": 33, "eadk_keyboard_scan": 34,
    "eadk_random": 45, "eadk_timing_millis": 48, "eadk_timing_msleep": 49,
    "eadk_timing_usleep": 50,
}
HEAD = '.syntax unified\n.thumb\n'

def fn(name, body):
    return f'{HEAD}.section .text.{name},"ax"\n.global {name}\n.type {name},%function\n.thumb_func\n{name}:\n{body}\n'

CRT = HEAD + """.section .text._start,"ax"
.global _start
.type _start,%function
.thumb_func
_start:
  push {r4, lr}
  ldr r0, =_data_section_start_ram
  ldr r1, =_data_section_end_ram
  ldr r2, =_data_section_start_flash
1: cmp r0, r1
  bhs 2f
  ldrb r3, [r2], #1
  strb r3, [r0], #1
  b 1b
2: ldr r0, =_bss_section_start_ram
  ldr r1, =_bss_section_end_ram
  movs r3, #0
3: cmp r0, r1
  bhs 4f
  strb r3, [r0], #1
  b 3b
4: movs r0, #0
  movs r1, #0
  bl main
  pop {r4, pc}
.ltorg
"""

SBRK = fn("_sbrk", """  ldr r1, =brk
  ldr r2, [r1]
  cbnz r2, 1f
  ldr r2, =_heap_start
1: adds r3, r2, r0
  ldr r12, =_heap_end
  cmp r3, r12
  bhs 2f
  str r3, [r1]
  mov r0, r2
  bx lr
2: mov r0, #-1
  bx lr
.ltorg
.bss
.align 2
brk: .word 0""")

LD = """MEMORY {
  FLASH (rx) : ORIGIN = %(fs)s, LENGTH = %(fl)s
  RAM (rwx) : ORIGIN = %(rs)s, LENGTH = %(rl)s
}
ENTRY(_start)
SECTIONS {
  .app_header ORIGIN(FLASH) : {
    LONG(0xDEC0BEBA)
    KEEP(*(.rodata.eadk_api_level))
    LONG(ADDR(.app_name) - ORIGIN(FLASH))
    LONG(SIZEOF(.app_icon))
    LONG(ADDR(.app_icon) - ORIGIN(FLASH))
    LONG(_start - ORIGIN(FLASH))
    LONG(_app_end - ORIGIN(FLASH))
    LONG(0xDEC0BEBA)
  } >FLASH
  .app_name : { KEEP(*(.rodata.eadk_app_name)) } >FLASH
  .app_icon : { KEEP(*(.rodata.eadk_app_icon)) } >FLASH
  .text : { . = ALIGN(4); *(.text) *(.text.*) } >FLASH
  .rodata : { *(.rodata) *(.rodata.*) } >FLASH
  .data : {
    . = ALIGN(4);
    _data_section_start_flash = LOADADDR(.data);
    _data_section_start_ram = .;
    *(.data) *(.data.*)
    . = ALIGN(4);
    _data_section_end_ram = .;
  } >RAM AT >FLASH
  _app_end = LOADADDR(.data) + SIZEOF(.data);
  .bss (NOLOAD) : {
    . = ALIGN(4);
    _bss_section_start_ram = .;
    *(.bss) *(.bss.*) *(COMMON)
    . = ALIGN(4);
    _bss_section_end_ram = .;
  } >RAM
  _heap_start = ALIGN(_bss_section_end_ram, 8);
  _heap_end = ORIGIN(RAM) + LENGTH(RAM);
  /DISCARD/ : { *(.ARM.exidx*) *(.ARM.extab*) }
}
ASSERT(SIZEOF(.app_header) == 32, "missing api level")
ASSERT(SIZEOF(.app_name) > 0, "missing app name")
ASSERT(SIZEOF(.app_icon) > 0, "missing app icon")
"""

def main():
    nwa, out = sys.argv[1], sys.argv[7]
    fs, fe, rs, re_, tr = (int(a, 0) for a in sys.argv[2:7])
    if not (fs < fe and rs < re_):
        sys.exit("bad memory ranges")
    with tempfile.TemporaryDirectory() as d:
        def asm(name, src):
            s, o = os.path.join(d, name + ".S"), os.path.join(d, name + ".o")
            open(s, "w").write(src)
            subprocess.run(["arm-none-eabi-as", "-mcpu=cortex-m7", "-mthumb", s, "-o", o], check=True)
            return o
        crt = asm("crt0", CRT)
        members = [asm(n, fn(n, f"  svc #{num}\n  bx lr")) for n, num in SVC.items()]
        members.append(asm("eadk_display_draw_string", fn("eadk_display_draw_string",
            f"  ldr r12, ={tr:#x}\n  ldr r12, [r12]\n  bx r12\n.ltorg")))
        members.append(asm("_sbrk", SBRK))
        lib = os.path.join(d, "libnwrt.a")
        subprocess.run(["arm-none-eabi-ar", "rcs", lib] + members, check=True)
        ld = os.path.join(d, "app.ld")
        open(ld, "w").write(LD % {"fs": hex(fs), "fl": hex(fe - fs), "rs": hex(rs), "rl": hex(re_ - rs)})
        elf = os.path.join(d, "app.elf")
        subprocess.run(["arm-none-eabi-ld", "-T", ld, "-u", "main",
                        "--no-warn-rwx-segments", "--no-warn-execstack", crt, nwa, lib, "-o", elf], check=True)
        subprocess.run(["arm-none-eabi-objcopy", "-O", "binary",
                        "-j", ".app_header", "-j", ".app_name", "-j", ".app_icon",
                        "-j", ".text", "-j", ".rodata", "-j", ".data", elf, out], check=True)

if __name__ == "__main__":
    main()
