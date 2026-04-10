#ifndef USER_H
#define USER_H

typedef struct {
    int id;
    char name[64];
} User;

User create_user(int id, const char* name);
void print_user(const User* u);

#endif
