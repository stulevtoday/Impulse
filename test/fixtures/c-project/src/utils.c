#include "include/utils.h"

int string_length(const char* s) {
    int len = 0;
    while (s[len]) len++;
    return len;
}

char* string_copy(char* dest, const char* src) {
    int i = 0;
    while (src[i]) {
        dest[i] = src[i];
        i++;
    }
    dest[i] = '\0';
    return dest;
}
