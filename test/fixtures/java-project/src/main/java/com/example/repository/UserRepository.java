package com.example.repository;

import com.example.model.User;
import java.util.ArrayList;
import java.util.List;

public class UserRepository {
    private final List<User> users = new ArrayList<>();

    public User save(User user) {
        users.add(user);
        return user;
    }

    public List<User> findAll() {
        return users;
    }
}
