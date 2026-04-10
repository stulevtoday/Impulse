<?php
namespace App\Services;

use App\Models\User;
use Illuminate\Support\Collection;

class UserService
{
    public function findAll(): Collection
    {
        return User::all();
    }

    public function create(string $name): User
    {
        return User::create(['name' => $name]);
    }
}
