#include "include/user.h"
#include "include/utils.h"
#include <stdio.h>
#include <string.h>

User create_user(int id, const char* name) {
    User u;
    u.id = id;
    string_copy(u.name, name);
    return u;
}

void print_user(const User* u) {
    if (u) {
        printf("User(%d, %s)\n", u->id, u->name);
    }
}
