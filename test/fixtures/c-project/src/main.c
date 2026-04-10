#include "include/user.h"
#include <stdlib.h>

int main(int argc, char** argv) {
    User u = create_user(1, "Pulse");
    print_user(&u);
    return 0;
}
