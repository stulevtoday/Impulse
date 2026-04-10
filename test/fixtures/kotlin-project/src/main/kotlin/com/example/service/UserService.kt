package com.example.service

import com.example.model.User

class UserService {
    fun greet(name: String): User {
        return User(name)
    }
}
