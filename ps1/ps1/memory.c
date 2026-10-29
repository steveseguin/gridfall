#include <stddef.h>

/* Use an ordinary loop on both targets. The SDK's assembly memset jumps
   into an unrolled instruction sequence, which psxw cannot lift yet. */
void *memset(void *destination, int value, size_t count)
{
    volatile unsigned char *out = destination;
    while (count--) *out++ = (unsigned char)value;
    return destination;
}
